import crypto from "node:crypto";
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
import appIdentity from "../config/app-identity.json" with { type: "json" };
import { isAiSafeGuidance } from "../lib/ai-source-policy.mjs";

const args = parseArgs(process.argv.slice(2));
const inputPath = args.input || process.env.SHIFT_BRAIN_APPROVED_JSONL || "/private/tmp/shift-brain-approved.jsonl";
const reportPath = args.report || process.env.SHIFT_BRAIN_REPORT_JSON || "/private/tmp/shift-brain-report.json";
const dryRun = args["dry-run"] === "true";
const replace = args.replace !== "false";
const sampleQuery = args["sample-query"] || "";
const embeddingProvider = (process.env.SHIFT_BRAIN_EMBEDDING_PROVIDER || (process.env.OPENROUTER_API_KEY ? "openrouter" : "openai")).toLowerCase();
const embeddingModel = process.env.SHIFT_BRAIN_EMBEDDING_MODEL || defaultEmbeddingModel(embeddingProvider);
const expectedDimensions = Number(process.env.SHIFT_BRAIN_EMBEDDING_DIMENSIONS || 1536);

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const embeddingApiKey = embeddingProvider === "openrouter" ? process.env.OPENROUTER_API_KEY : process.env.OPENAI_API_KEY;

if (!fs.existsSync(inputPath)) {
  console.error(`Approved JSONL not found: ${inputPath}. Run scripts/prepare-shift-brain.mjs first.`);
  process.exit(1);
}

const docs = readJsonl(inputPath);
if (docs.some(doc => !isAiSafeGuidance(doc))) {
  console.error("Refusing to embed knowledge with excluded or unverified machine-source provenance.");
  process.exit(1);
}
const report = fs.existsSync(reportPath) ? JSON.parse(fs.readFileSync(reportPath, "utf8")) : {};
const chunks = docs.flatMap((doc) => chunkDoc(doc, embeddingModel));

console.log(`Prepared ${docs.length} docs and ${chunks.length} chunks from ${inputPath}.`);
if (replace && (docs.length === 0 || chunks.length === 0)) {
  console.error("Refusing to replace the live SHIFT brain corpus with an empty approved input.");
  process.exit(1);
}
if (sampleQuery) {
  printLexicalSample(chunks, sampleQuery);
}
if (dryRun) {
  console.log("Dry run only; no embeddings or database writes performed.");
  process.exit(0);
}

if (!supabaseUrl || !serviceRoleKey) {
  console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for ingestion.");
  process.exit(1);
}
if (!["openai", "openrouter"].includes(embeddingProvider)) {
  console.error("SHIFT_BRAIN_EMBEDDING_PROVIDER must be openai or openrouter.");
  process.exit(1);
}
if (!embeddingApiKey) {
  console.error(`${embeddingProvider === "openrouter" ? "OPENROUTER_API_KEY" : "OPENAI_API_KEY"} is required to generate embeddings.`);
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const runPayload = {
  source_name: report.source || inputPath.split("/").at(-1) || "shift-brain-approved.jsonl",
  source_sha256: report.source_sha256 || null,
  review_sha256: report.review_sha256 || null,
  scope: report.scope || "client",
  total_rows: report.total_rows || docs.length,
  approved_rows: docs.length,
  excluded_rows: report.excluded_rows || 0,
  chunk_rows: chunks.length,
  embedding_model: embeddingModel,
  report,
};

const { data: run, error: runError } = await supabase
  .from("brain_ingestion_runs")
  .insert(runPayload)
  .select("id")
  .single();
if (runError || !run) {
  throw new Error(`Could not create ingestion run: ${runError?.message || "unknown error"}`);
}

const docsForDb = docs.map((doc) => ({
  id: doc.id,
  source_title: doc.source_title,
  category: doc.category,
  provenance: doc.provenance,
  audience: doc.audience,
  text: doc.text,
  principles: doc.principles,
  coaching_moves: doc.coaching_moves,
  hierarchy_links: doc.hierarchy_links,
  pii_risk: "none",
  platform_flag: doc.platform_flag || "none",
  source_hash: doc.source_hash,
  ingestion_run_id: run.id,
  updated_at: new Date().toISOString(),
}));

const docTable = replace ? "brain_doc_staging" : "brain_docs";
const chunkTable = replace ? "brain_chunk_staging" : "brain_chunks";

if (replace) {
  await assertOk(supabase.from("brain_chunk_staging").delete().eq("ingestion_run_id", run.id), "clear staged brain chunks");
  await assertOk(supabase.from("brain_doc_staging").delete().eq("ingestion_run_id", run.id), "clear staged brain docs");
}

for (const batch of batches(docsForDb, 100)) {
  const query = supabase.from(docTable).upsert(batch, { onConflict: replace ? "ingestion_run_id,id" : "id" });
  await assertOk(query, `upsert ${replace ? "staged " : ""}brain docs`);
}

let insertedChunks = 0;
for (const batch of batches(chunks, 80)) {
  const embeddings = await createEmbeddings(batch.map((chunk) => chunk.embeddingInput));
  const rows = batch.map((chunk, index) => {
    const embedding = embeddings[index];
    if (!embedding || embedding.length !== expectedDimensions) {
      throw new Error(`Unexpected embedding dimension for ${chunk.doc_id}#${chunk.chunk_index}: ${embedding?.length || 0}`);
    }
    return {
      doc_id: chunk.doc_id,
      chunk_index: chunk.chunk_index,
      chunk: chunk.chunk,
      chunk_hash: chunk.chunk_hash,
      token_estimate: chunk.token_estimate,
      embedding_model: embeddingModel,
      embedding,
      ...(replace ? { ingestion_run_id: run.id } : {}),
    };
  });
  await assertOk(supabase.from(chunkTable).insert(rows), `insert ${replace ? "staged " : ""}brain chunks`);
  insertedChunks += rows.length;
  console.log(`Inserted ${insertedChunks}/${chunks.length} chunks`);
}

if (replace) {
  const { data: promoted, error: promoteError } = await supabase.rpc("promote_shift_brain_ingestion", {
    p_run_id: run.id,
  });
  if (promoteError) {
    throw new Error(`Failed to promote staged brain ingestion: ${promoteError.message}`);
  }
  const result = promoted?.[0];
  console.log(`Promoted staged corpus: ${result?.doc_rows ?? docs.length} docs, ${result?.chunk_rows ?? chunks.length} chunks`);
}

console.log(`SHIFT brain ingestion complete. Run ${run.id}: ${docs.length} docs, ${chunks.length} chunks.`);

function defaultEmbeddingModel(provider) {
  return provider === "openrouter" ? "openai/text-embedding-3-small" : "text-embedding-3-small";
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) parsed[key] = "true";
    else {
      parsed[key] = next;
      index += 1;
    }
  }
  return parsed;
}

function readJsonl(filePath) {
  return fs.readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
}

function chunkDoc(doc, model) {
  const words = doc.text.split(/\s+/).filter(Boolean);
  const chunks = [];
  const maxWords = 420;
  const overlap = 60;
  if (words.length <= maxWords) {
    chunks.push(makeChunk(doc, 0, doc.text, model));
    return chunks;
  }
  let index = 0;
  for (let start = 0; start < words.length; start += maxWords - overlap) {
    const text = words.slice(start, start + maxWords).join(" ");
    chunks.push(makeChunk(doc, index, text, model));
    index += 1;
    if (start + maxWords >= words.length) break;
  }
  return chunks;
}

function makeChunk(doc, chunkIndex, chunk, model) {
  const hierarchy = Array.isArray(doc.hierarchy_links) && doc.hierarchy_links.length
    ? `Hierarchy: ${doc.hierarchy_links.join(", ")}\n`
    : "";
  return {
    doc_id: doc.id,
    chunk_index: chunkIndex,
    chunk,
    chunk_hash: sha256(`${doc.id}:${chunkIndex}:${chunk}`),
    token_estimate: Math.ceil(chunk.split(/\s+/).filter(Boolean).length * 1.33),
    embedding_model: model,
    embeddingInput: `Title: ${doc.source_title}\nCategory: ${doc.category}\n${hierarchy}${chunk}`,
  };
}

async function createEmbeddings(inputs) {
  const body = {
    model: embeddingModel,
    input: inputs,
    ...(embeddingProvider === "openrouter" ? { provider: { zdr: true } } : {}),
  };
  const response = await fetch(embeddingEndpoint(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${embeddingApiKey}`,
      ...openRouterHeaders(),
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`${embeddingProvider} embeddings failed: ${response.status} ${await response.text()}`);
  }
  const data = await response.json();
  return data.data
    .sort((a, b) => a.index - b.index)
    .map((item) => item.embedding);
}

function embeddingEndpoint() {
  if (embeddingProvider === "openrouter") {
    return `${process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1"}/embeddings`;
  }
  return "https://api.openai.com/v1/embeddings";
}

function openRouterHeaders() {
  if (embeddingProvider !== "openrouter") return {};
  return {
    "HTTP-Referer": process.env.SHIFT_BRAIN_OPENROUTER_REFERER || appIdentity.productionUrl,
    "X-OpenRouter-Title": process.env.SHIFT_BRAIN_OPENROUTER_TITLE || "Gordy Elliott AT CAPACITY Portal",
  };
}

async function assertOk(query, action) {
  const { error } = await query;
  if (error) throw new Error(`Failed to ${action}: ${error.message}`);
}

function batches(items, size) {
  const result = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

function sha256(input) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function printLexicalSample(chunks, query) {
  const queryTerms = new Set(query.toLowerCase().split(/[^a-z0-9]+/).filter((term) => term.length > 3));
  const scored = chunks
    .map((chunk) => {
      const haystack = chunk.embeddingInput.toLowerCase();
      let score = 0;
      for (const term of queryTerms) {
        if (haystack.includes(term)) score += 1;
      }
      return { ...chunk, score };
    })
    .filter((chunk) => chunk.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  console.log(`Sample lexical check for "${query}": ${scored.length} candidate chunks`);
  for (const chunk of scored) {
    console.log(`- ${chunk.doc_id}#${chunk.chunk_index} score=${chunk.score}: ${chunk.chunk.slice(0, 180).replace(/\s+/g, " ")}${chunk.chunk.length > 180 ? "..." : ""}`);
  }
}
