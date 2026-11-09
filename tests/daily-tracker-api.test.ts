import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
import * as steps from "../lib/daily-steps";

const requireActual = createRequire(import.meta.url);
const clientId = "owned-client";
const selectedDate = "2026-01-05";

async function handlerFixture(now?: Date) {
  const queries: Array<{ table: string; filters: Record<string, unknown>; limit?: number; payload?: Record<string, unknown> }> = [];
  let metric: Record<string, unknown> = { id: "metric-1", tracked_date: selectedDate, manual_steps: 8000, training_completed: false };
  const admin = {
    from(table: string) {
      const query: (typeof queries)[number] = { table, filters: {} };
      queries.push(query);
      const builder = {
        select() { return builder; },
        eq(key: string, value: unknown) { query.filters[key] = value; return builder; },
        lte() { return builder; },
        order() { return builder; },
        limit(value: number) { query.limit = value; return builder; },
        upsert(value: Record<string, unknown>) { query.payload = value; return builder; },
        single() { return Promise.resolve(result()); },
        maybeSingle() { return Promise.resolve(result()); },
        then(resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) { return Promise.resolve(result()).then(resolve, reject); },
      };
      function result() {
        if (table === "client_profiles") return { data: { id: clientId }, error: null };
        assert.equal(query.filters.client_id ?? query.payload?.client_id, clientId, "every data query is scoped to the authenticated client's profile");
        if (query.payload) {
          metric = { ...metric, ...query.payload };
          return { data: metric, error: null };
        }
        if (table === "client_daily_metrics") return { data: query.filters.tracked_date ? metric : [], error: null };
        if (table === "client_wearable_daily_summaries") return { data: query.filters.summary_date ? null : [], error: null };
        if (table === "client_exercise_session_summaries") return { data: query.filters.log_date === selectedDate ? [{ log_date: selectedDate }] : [{ log_date: "2026-10-06" }], error: null };
        throw new Error(`Unexpected table: ${table}`);
      }
      return builder;
    },
  };
  const source = await readFile(new URL("../app/api/portal/daily-tracker/route.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports: { GET?: (request: Request) => Promise<Response>; POST?: (request: Request) => Promise<Response> } = {};
  new Function("require", "exports", compiled)((id: string) => {
    if (id === "@/lib/supabase/admin") return { createAdminClient: () => admin };
    if (id === "@/lib/supabase/server") return { createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: "signed-in-user" } } }) } }) };
    if (id === "@/lib/daily-steps") return { ...steps, coachingDateKey: (date: Date, zone?: string) => steps.coachingDateKey(now || date, zone) };
    return requireActual(id);
  }, exports);
  return { GET: exports.GET!, POST: exports.POST!, queries, getMetric: () => metric };
}

test("historical tracker selection includes completed sessions beyond the recent history slice", async () => {
  const fixture = await handlerFixture();
  const response = await fixture.GET(new Request(`https://app.example.invalid/api/portal/daily-tracker?date=${selectedDate}&clientId=someone-else`));
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.selectedEntry.tracked_date, selectedDate);
  assert.equal(data.selectedEntry.manual_steps, 8000);
  assert.equal(data.selectedEntry.training_completed, true);
  assert.ok(data.trainingDates.includes(selectedDate));
  assert.equal(fixture.queries.find((query) => query.table === "client_exercise_session_summaries" && query.filters.log_date === selectedDate)?.limit, 1);
});

test("tracker saves retain old-app manual totals, support clearing and zero, and reject malformed input", async () => {
  const fixture = await handlerFixture();
  const save = (data: Record<string, unknown>) => fixture.POST(new Request("https://app.example.invalid/api/portal/daily-tracker", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tracked_date: selectedDate, ...data }),
  }));
  assert.equal((await save({ notes: "An older app request" })).status, 200);
  assert.equal(fixture.getMetric().manual_steps, 8000);
  assert.equal((await save({ manual_steps: 0 })).status, 200);
  assert.equal(fixture.getMetric().manual_steps, 0);
  assert.equal((await save({ manual_steps: "" })).status, 200);
  assert.equal(fixture.getMetric().manual_steps, null);
  const writes = () => fixture.queries.filter((query) => query.payload).length;
  const previous = writes();
  for (const manual_steps of [-1, 1.5, "not steps"]) assert.equal((await save({ manual_steps })).status, 400);
  assert.equal(writes(), previous);
});

test("coach data loading includes the manual step total required by its renderer", async () => {
  const source = await readFile(new URL("../lib/admin-data.ts", import.meta.url), "utf8");
  const dailySelect = source.match(/\.from\("client_daily_metrics"\)\s*\.select\("([^"]+)"\)/)?.[1].split(/,\s*/);
  assert.ok(dailySelect?.includes("manual_steps"));
});

test("tracker API uses the same local day for defaults and future-date validation", async () => {
  const fixture = await handlerFixture(new Date("2026-11-03T03:42:00Z"));
  const url = "https://app.example.invalid/api/portal/daily-tracker";
  const headers = { "content-type": "application/json", "x-client-timezone": "America/Chicago" };
  assert.equal((await fixture.POST(new Request(url, { method: "POST", headers, body: "{}" }))).status, 200);
  assert.equal(fixture.getMetric().tracked_date, "2026-11-02");
  const writes = fixture.queries.filter(q => q.payload).length;
  assert.equal((await fixture.POST(new Request(url, { method: "POST", headers, body: JSON.stringify({ tracked_date: "2026-11-03" }) }))).status, 400);
  assert.equal(fixture.queries.filter(q => q.payload).length, writes);
  assert.equal((await fixture.GET(new Request(url + "?date=2026-11-02", { headers }))).status, 200);
  assert.equal((await fixture.GET(new Request(url + "?date=2026-11-03", { headers }))).status, 400);
  assert.equal((await fixture.GET(new Request(url, { headers: { "x-client-timezone": "Mars/Olympus" } }))).status, 400);
  const ahead = { ...headers, "x-client-timezone": "Pacific/Kiritimati" };
  const tomorrow = await handlerFixture(new Date("2026-11-02T12:30:00Z"));
  assert.equal((await tomorrow.POST(new Request(url, { method: "POST", headers: ahead, body: JSON.stringify({ tracked_date: "2026-11-03" }) }))).status, 200);
  // Old app versions still use their existing default until they load the updated UI.
  assert.equal((await fixture.POST(new Request(url, { method: "POST", body: "{}" }))).status, 200);
  assert.equal(fixture.getMetric().tracked_date, "2026-11-03");
});
