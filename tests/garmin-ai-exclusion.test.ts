import assert from "node:assert/strict";
import test from "node:test";
import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import ts from "typescript";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AI_CONTEXT_POLICY, aiConversationHistory, aiManualDailyRatings, hasExcludedMachineProvenance } from "../lib/ai-source-policy.mjs";
import { aiWearableSummaries } from "../lib/ai-wearable-context";
import { getShiftBrainContextResult } from "../lib/brain-retrieval";

type Row = Record<string, unknown>;
const requireActual = createRequire(import.meta.url);
const safe = {
  id: "safe", client_id: "client", summary_date: "2026-11-09", providers: ["myfitnesspal"], source_payload_ids: ["mfp-event"],
  sleep_minutes: null, sleep_score: null, hrv_ms: null, resting_hr_bpm: null, steps: null,
  active_calories: null, total_calories_burned: null, training_load: null, workout_count: null,
  nutrition_calories: 2222, protein_g: 144, carbs_g: 200, fat_g: 70, water_ml: null,
  readiness_score: null, recovery_status: "unknown" as const, flags: [], insight: null,
};
const rows = [
  { ...safe, id: "garmin", providers: ["GARMIN"], source_payload_ids: ["garmin-event"], insight: "FORBIDDEN_GARMIN_SOURCE", sleep_minutes: 9173 },
  { ...safe, id: "blend", providers: ["myfitnesspal", "garmin"], source_payload_ids: ["garmin-event", "mfp-event"], insight: "FORBIDDEN_MIXED_DERIVATIVE" },
  { ...safe, id: "unknown", providers: [], source_payload_ids: [], insight: "FORBIDDEN_UNKNOWN_SOURCE" },
  { ...safe, id: "disguised", source_payload_ids: ["garmin-event"], insight: "FORBIDDEN_CONTRADICTORY_PROVENANCE" },
  { ...safe, id: "missing", source_payload_ids: ["missing-event"], insight: "FORBIDDEN_MISSING_REFERENCE" },
  { ...safe, id: "foreign", source_payload_ids: ["foreign-event"], insight: "FORBIDDEN_OTHER_CLIENT" },
  safe,
];
const events = [
  { id: "mfp-event", client_id: "client", provider: "myfitnesspal" },
  { id: "garmin-event", client_id: "client", provider: "garmin" },
  { id: "foreign-event", client_id: "someone-else", provider: "myfitnesspal" },
];

function database(failSources = false) {
  const profile = { id: "client", user_id: "user", programme_type: "capacity", tier: "coached", consultation_data: {}, lifecycle_status: "active", user: { full_name: "Fictional Client", email: "fixture@example.invalid" } };
  return { from(table: string) {
    let single = false;
    const filters: Row = {};
    const builder: Record<string, unknown> = {};
    for (const method of ["select", "order", "limit", "gte", "lte", "contains", "update", "insert", "range", "not"]) builder[method] = () => builder;
    builder.eq = (key: string, value: unknown) => { filters[key] = value; return builder; };
    builder.in = (key: string, value: unknown) => { filters[key] = value; return builder; };
    function result() {
      let data: unknown = [];
      if (table === "client_profiles") data = single ? profile : [profile];
      if (table === "users") data = { id: "user", full_name: "Fictional Client" };
      if (table === "form_config") data = { config: {} };
      if (table === "client_wearable_connections") data = [{ client_id: "client", provider: "garmin", status: "connected", last_sync_at: "FORBIDDEN_GARMIN_SYNC" }, { client_id: "client", provider: "myfitnesspal", status: "connected" }];
      if (table === "client_wearable_daily_summaries") data = rows;
      if (table === "client_wearable_events") data = events.filter(row => (filters.id as string[] || []).includes(row.id));
      if (table === "client_modules") data = [{ id: "assignment", status: "assigned", module: { id: "education", title: "Safe training" } }];
      if (table === "client_daily_metrics") data = single ? { tracked_date: "2026-11-09", sleep_hours: 9173, energy_level: 5 } : [];
      if (single && Array.isArray(data)) data = data[0] || null;
      return { data, error: table === "client_wearable_events" && failSources ? { message: "provenance unavailable" } : null };
    }
    builder.single = builder.maybeSingle = () => { single = true; return Promise.resolve(result()); };
    builder.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve(result()).then(resolve, reject);
    return builder;
  } } as unknown as SupabaseClient;
}

test("source projection excludes Garmin, blends, missing/contradictory/foreign provenance and retains verified MFP", async () => {
  assert.deepEqual((await aiWearableSummaries(database(), rows)).map(row => row.id), ["safe"]);
  assert.deepEqual(await aiWearableSummaries(database(true), rows), []);
  assert.deepEqual(await aiWearableSummaries(database(), [{ ...safe, source_payload_ids: [] }]), []);
  for (const provider of ["GARMIN", "Garmin Connect", "garmin_direct", "apple", "healthconnect", "unknown"]) {
    assert.deepEqual(await aiWearableSummaries(database(), [{ ...safe, providers: [provider] }]), []);
  }
  assert.equal(hasExcludedMachineProvenance({ providers: ["oura"], derived_from: { provider: "Garmin" } }), true);
  assert.equal(hasExcludedMachineProvenance("Can I connect a Garmin watch?"), false, "ordinary conversation is not classified as a machine record");
  assert.deepEqual(aiManualDailyRatings({ tracked_date: "2026-11-09", sleep_hours: 9173, energy_level: 5 }), { tracked_date: "2026-11-09", energy_level: 5 });
});

async function route(path: string, failSources = false) {
  const admin = database(failSources);
  const source = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports: { POST?: (request: Request) => Promise<Response> } = {};
  new Function("require", "exports", compiled)((id: string) => {
    if (id === "@/lib/supabase/admin") return { createAdminClient: () => admin };
    if (id === "@/lib/supabase/server") return { createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: "user" } } }) } }) };
    if (id === "@/lib/admin-auth") return { requireAdmin: async () => ({ authorized: true }) };
    if (id === "@/lib/rate-limit") return { rateLimit: () => ({ success: true }) };
    if (id === "@/lib/ai-usage") return { trackAIUsage: async () => {} };
    if (id === "@/lib/consultation-config") return { loadConsultationConfig: async () => ({ questions: [] }) };
    if (id === "@/lib/brain-retrieval") return { getShiftBrainContextResult: async () => ({ context: "Safe reviewed knowledge", embeddingUsage: null }) };
    if (id === "@/lib/cycle-tracking") return { toDateKey: () => "2026-11-09", isCycleEligible: () => true, getCyclePhase: () => null };
    return requireActual(id);
  }, exports);
  return exports.POST!;
}

test("real client/admin request payloads and client tool follow-up never contain excluded machine context", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = "fictional-test-key";
  try {
    for (const path of ["app/api/portal/ai/route.ts", "app/api/admin/ai/route.ts"]) {
      for (const failSources of [false, true]) {
        const captured: Row[] = [];
        globalThis.fetch = async (_url, init) => {
          captured.push(JSON.parse(String(init?.body)));
          if (path.includes("portal") && captured.length === 1) return Response.json({ stop_reason: "tool_use", content: [{ type: "tool_use", id: "tool", name: "mark_training_started", input: { module_id: "education" } }] });
          return Response.json({ content: [{ type: "text", text: "A safe fictional answer" }] });
        };
        const post = await route(path, failSources);
        const response = await post(new Request("https://fixture.invalid/api/ai", { method: "POST", body: JSON.stringify({ message: "Show my coaching context", history: [{ role: "assistant", content: "FORBIDDEN_LEGACY_MACHINE_REPLY" }, { role: "assistant", content: "SAFE_CURRENT_REPLY", contextPolicy: AI_CONTEXT_POLICY }, { role: "user", content: "My own previous question" }] }) }));
        assert.equal(response.status, 200, await response.clone().text());
        assert.equal((await response.json()).contextPolicy, AI_CONTEXT_POLICY);
        assert.equal(captured.length, path.includes("portal") ? 2 : 1);
        for (const payload of captured) {
          const transmitted = JSON.stringify(payload);
          assert.doesNotMatch(transmitted, /FORBIDDEN_|9173/);
          assert.match(transmitted, /SAFE_CURRENT_REPLY/);
          if (!failSources) assert.match(transmitted, /2222/, "verified non-Garmin nutrition remains available");
          else assert.doesNotMatch(transmitted, /2222/, "lookup errors fail closed without a cached-summary fallback");
        }
      }
    }
  } finally { globalThis.fetch = originalFetch; if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = originalKey; }
});

test("legacy machine replies are not resent, while manual questions and current-policy replies remain", () => {
  assert.deepEqual(aiConversationHistory([{ role: "assistant", content: "old machine content" }, { role: "assistant", content: "new answer", contextPolicy: AI_CONTEXT_POLICY }, { role: "user", content: "Can Garmin connect?" }]), [{ role: "assistant", content: "new answer" }, { role: "user", content: "Can Garmin connect?" }]);
});

test("embedding retrieval blocks structured Garmin queries before any provider request", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error("No provider call permitted"); };
  try {
    await getShiftBrainContextResult(database(), JSON.stringify({ provider: "GARMIN", sleep: 9173 }));
    assert.equal(calls, 0);
  } finally { globalThis.fetch = original; }
});

test("offline knowledge ingestion refuses Garmin provenance before embeddings or database writes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "garmin-ai-test-"));
  try {
    const input = join(dir, "docs.jsonl");
    await writeFile(input, JSON.stringify({ id: "fictional", provenance: "gordy_direct", providers: ["garmin"], text: "Fictional imported record" }) + "\n");
    assert.throws(() => execFileSync(process.execPath, ["scripts/ingest-shift-brain.mjs", "--input", input, "--dry-run", "true"], { encoding: "utf8", stdio: "pipe" }), /excluded or unverified machine-source provenance/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
