import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
import * as programmes from "../lib/programmes";
const requireActual = createRequire(import.meta.url);

async function fixture(authorized = true) {
  const writes: Array<{ id: unknown; updates: Record<string, unknown> }> = [];
  const source = await readFile(new URL("../app/api/admin/clients/[id]/route.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const admin = { from(table: string) {
    assert.equal(table, "client_profiles");
    let id: unknown;
    let updates: Record<string, unknown> | undefined;
    const query = {
      select() { return query; },
      eq(field: string, value: unknown) { assert.equal(field, "id"); id = value; return query; },
      update(value: Record<string, unknown>) { updates = value; return query; },
      async maybeSingle() {
        if (updates) writes.push({ id, updates });
        return { data: { user_id: "fixture-user", onboarding_status: "active", activated_at: "2026-01-01", sex: null, programme_type: "capacity", checkin_form_id: null, ...updates }, error: null };
      },
    };
    return query;
  } };
  const exports: { PATCH?: (request: Request, context: { params: Promise<{ id: string }> }) => Promise<Response> } = {};
  new Function("require", "exports", compiled)((id: string) => {
    if (id === "@/lib/supabase/admin") return { createAdminClient: () => admin };
    if (id === "@/lib/admin-auth") return { requireAdmin: async () => ({ authorized, error: "Forbidden", status: 403, userId: "fixture-admin" }) };
    if (id === "@/lib/programmes") return programmes;
    if (["@/lib/account-provider-revocation", "@/lib/consultation-config", "@/lib/consultation-metrics", "@/lib/admin-data"].includes(id)) return {};
    if (id === "@/lib/client-notifications") return { notifyClientUser() { throw new Error("Profile edits must not notify clients"); } };
    if (id === "@/lib/api-errors") return { dbError() { throw new Error("Unexpected database error"); } };
    return requireActual(id);
  }, exports);
  return { writes, patch: (body: Record<string, unknown>) => exports.PATCH!(new Request("https://fixture.invalid/api/admin/clients/fixture-client", { method: "PATCH", body: JSON.stringify(body) }), { params: Promise.resolve({ id: "fixture-client" }) }) };
}

test("admin can save, replace and clear goals on the requested profile", async () => {
  const f = await fixture();
  for (const goals of ["Complete three sessions weekly", "Updated goal\nKeep existing formatting", "", null]) {
    const response = await f.patch({ goals });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).client.goals, goals);
    assert.deepEqual(f.writes.at(-1), { id: "fixture-client", updates: { goals } });
  }
});
test("invalid goals never write, including when combined with an otherwise valid field", async () => {
  const f = await fixture();
  for (const goals of [1, true, {}, [], "x".repeat(10001)]) assert.equal((await f.patch({ goals, coach_notes: "valid" })).status, 400);
  assert.deepEqual(f.writes, []);
});
test("other allowed profile edits still work and unknown fields stay excluded", async () => {
  const f = await fixture();
  assert.equal((await f.patch({ goals: "Goal", coach_notes: "Coach note", user_id: "other-user", role: "admin" })).status, 200);
  assert.deepEqual(f.writes[0], { id: "fixture-client", updates: { goals: "Goal", coach_notes: "Coach note" } });
  assert.equal((await f.patch({ checkin_day: "Monday" })).status, 200);
  assert.equal((await f.patch({ role: "admin" })).status, 400);
  assert.equal((await f.patch({ fitness_plans_enabled: "true" })).status, 400);
});
test("profile goal edits retain admin authentication", async () => {
  const f = await fixture(false);
  assert.equal((await f.patch({ goals: "Goal" })).status, 403);
  assert.deepEqual(f.writes, []);
});
