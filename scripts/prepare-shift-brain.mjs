import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { isAiSafeGuidance } from "../lib/ai-source-policy.mjs";

const REQUIRED_FIELDS = {
  id: "string",
  source_title: "string",
  category: "string",
  provenance: "string",
  audience: "string",
  text: "string",
  principles: "array",
  coaching_moves: "array",
  hierarchy_links: "array",
  pii_risk: "string",
};
const ALLOWED_CATEGORIES = new Set(["methodology", "build", "client_session", "other"]);
const ALLOWED_PROVENANCE = new Set(["gordy_direct", "client_session_distilled"]);
const ALLOWED_AUDIENCES = new Set(["client", "admin", "both"]);
const CLIENT_SCOPE_CATEGORIES = new Set(["methodology", "client_session"]);

const args = parseArgs(process.argv.slice(2));
const brainPath = args.brain || process.env.SHIFT_BRAIN_JSONL;
const reviewPath = args.review || process.env.SHIFT_BRAIN_REVIEW_CSV;
const scope = args.scope || process.env.SHIFT_BRAIN_SCOPE || "client";
const outPath = args.out || "/private/tmp/shift-brain-approved.jsonl";
const reportPath = args.report || "/private/tmp/shift-brain-report.json";

if (!brainPath || !reviewPath) {
  console.error("Usage: node scripts/prepare-shift-brain.mjs --brain path/to/brain.jsonl --review path/to/review.csv [--scope client|all-approved] [--out approved.jsonl] [--report report.json]");
  process.exit(1);
}
if (!["client", "all-approved"].includes(scope)) {
  console.error("--scope must be client or all-approved");
  process.exit(1);
}

const reviewById = readReviewCsv(reviewPath);
const rows = readJsonl(brainPath);
const approved = [];
const excluded = [];
const counts = {};

for (const { lineNumber, value } of rows) {
  const reasons = exclusionReasons(value, reviewById.get(value.id), scope);
  if (reasons.length > 0) {
    excluded.push({
      line: lineNumber,
      id: value.id || null,
      title: value.source_title || null,
      category: value.category || null,
      reasons,
    });
    for (const reason of reasons) counts[reason] = (counts[reason] || 0) + 1;
    continue;
  }

  const review = reviewById.get(value.id);
  const normalized = {
    id: value.id,
    source_title: value.source_title,
    category: value.category,
    provenance: value.provenance,
    audience: value.audience,
    text: value.text.trim(),
    principles: value.principles,
    coaching_moves: value.coaching_moves,
    hierarchy_links: value.hierarchy_links,
    pii_risk: "none",
    platform_flag: review?.platform_flag || "none",
    source_hash: sha256(JSON.stringify(value)),
  };
  approved.push(normalized);
}

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, approved.map((row) => JSON.stringify(row)).join("\n") + (approved.length ? "\n" : ""));

const report = {
  source: path.basename(brainPath),
  review: path.basename(reviewPath),
  scope,
  total_rows: rows.length,
  approved_rows: approved.length,
  excluded_rows: excluded.length,
  excluded_by_reason: counts,
  source_sha256: sha256(fs.readFileSync(brainPath)),
  review_sha256: sha256(fs.readFileSync(reviewPath)),
  approved_sha256: sha256(fs.readFileSync(outPath)),
  approved_categories: countBy(approved, "category"),
  excluded_sample: excluded.slice(0, 30),
};
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

console.log(`Approved ${approved.length} of ${rows.length} rows for ${scope} scope.`);
console.log(`Excluded ${excluded.length} rows. Report: ${reportPath}`);
console.log(`Approved JSONL: ${outPath}`);

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = "true";
    } else {
      parsed[key] = next;
      index += 1;
    }
  }
  return parsed;
}

function readJsonl(filePath) {
  return fs.readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .map((line, index) => ({ line, lineNumber: index + 1 }))
    .filter(({ line }) => line.trim())
    .map(({ line, lineNumber }) => {
      try {
        return { lineNumber, value: JSON.parse(line) };
      } catch (error) {
        return { lineNumber, value: { id: null, source_title: null, parse_error: error.message } };
      }
    });
}

function readReviewCsv(filePath) {
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/).filter(Boolean);
  const [headerLine, ...body] = lines;
  const headers = parseCsvLine(headerLine);
  const idIndex = headers.indexOf("id");
  const result = new Map();
  for (const line of body) {
    const columns = parseCsvLine(line);
    const id = columns[idIndex];
    if (!id) continue;
    result.set(id, Object.fromEntries(headers.map((header, index) => [header, columns[index] || ""])));
  }
  return result;
}

function parseCsvLine(line) {
  const values = [];
  let current = "";
  let inQuotes = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"' && line[index + 1] === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      values.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  values.push(current);
  return values;
}

function exclusionReasons(row, review, selectedScope) {
  const reasons = [];
  if (!isAiSafeGuidance(row)) reasons.push("excluded_or_unverified_ai_source");
  if (row.parse_error) reasons.push("invalid_json");
  for (const [field, type] of Object.entries(REQUIRED_FIELDS)) {
    if (!(field in row)) reasons.push(`missing_${field}`);
    else if (type === "array" ? !Array.isArray(row[field]) : typeof row[field] !== type) reasons.push(`invalid_${field}`);
  }
  if (typeof row.category === "string" && !ALLOWED_CATEGORIES.has(row.category)) reasons.push("unknown_category");
  if (typeof row.provenance === "string" && !ALLOWED_PROVENANCE.has(row.provenance)) reasons.push("unknown_provenance");
  if (typeof row.audience === "string" && !ALLOWED_AUDIENCES.has(row.audience)) reasons.push("unknown_audience");
  if (selectedScope === "client" && typeof row.category === "string" && !CLIENT_SCOPE_CATEGORIES.has(row.category)) reasons.push("excluded_category_for_client_scope");
  if (selectedScope === "client" && typeof row.audience === "string" && !["client", "both"].includes(row.audience)) reasons.push("excluded_audience_for_client_scope");
  if (!review) reasons.push("missing_review_csv_row");
  if (row.pii_risk !== "none") reasons.push("pii_risk_review");
  if (review && review.platform_flag !== "none") reasons.push("platform_flag_review");
  if (typeof row.text !== "string" || row.text.trim().length === 0) reasons.push("empty_text");
  return reasons;
}

function sha256(input) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function countBy(rowsToCount, key) {
  return rowsToCount.reduce((acc, row) => {
    acc[row[key]] = (acc[row[key]] || 0) + 1;
    return acc;
  }, {});
}
