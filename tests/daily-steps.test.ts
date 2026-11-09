import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { coachingDateKey, trackerTimeZone, isValidTrackerDate, parseManualSteps, resolveDailySteps } from "../lib/daily-steps";

test("blank steps are unknown and manual zero overrides synced activity without adding totals", () => {
  for (const value of [null, undefined, "", "   "]) assert.deepEqual(parseManualSteps(value), { value: null });
  assert.deepEqual(parseManualSteps("0"), { value: 0 });
  assert.deepEqual(parseManualSteps(" 8000 "), { value: 8000 });
  assert.deepEqual(resolveDailySteps(0, 8500), { value: 0, source: "manual" });
  assert.deepEqual(resolveDailySteps(8000, 8500), { value: 8000, source: "manual" });
  assert.deepEqual(resolveDailySteps(null, 0), { value: 0, source: "synced" });
  assert.deepEqual(resolveDailySteps(null, 8500), { value: 8500, source: "synced" });
  assert.deepEqual(resolveDailySteps(null, null), { value: null, source: null });
});

test("malformed step input is rejected instead of rounded, clamped or treated as empty", () => {
  for (const value of [-1, 1.5, NaN, Infinity, true, false, [], {}, "1.5", "-1", "1e3", "8000 steps", "8,000", "0x10", 2_147_483_648]) {
    assert.equal(parseManualSteps(value).error, "Steps must be a whole number of 0 or more.", String(value));
  }
  assert.deepEqual(parseManualSteps(2_147_483_647), { value: 2_147_483_647 });
});

test("tracker date validation rejects rollover, incomplete and future dates while retaining leap days", () => {
  for (const value of ["2026-02-30", "2025-02-29", "2026-13-01", "2026-10-08", "2026-10-7", "2026-10-07T00:00:00Z", "", null]) {
    assert.equal(isValidTrackerDate(value, "2026-10-07"), false, String(value));
  }
  for (const value of ["2024-02-29", "2026-03-29", "2026-10-07"]) assert.equal(isValidTrackerDate(value, "2026-10-07"), true);
});

test("migrated daily metrics preserve null and zero, constrain negative steps and isolate dates", async () => {
  const db = new PGlite();
  try {
    await db.exec("CREATE TABLE public.client_daily_metrics (client_id TEXT NOT NULL, tracked_date DATE NOT NULL, notes TEXT, UNIQUE(client_id, tracked_date));");
    await db.exec(await readFile(new URL("../supabase/migrations/20261007141000_manual_daily_steps.sql", import.meta.url), "utf8"));
    await db.query("INSERT INTO client_daily_metrics (client_id, tracked_date, manual_steps) VALUES ('client-a', '2026-10-06', 8000), ('client-a', '2026-10-07', 0), ('client-b', '2026-10-07', NULL)");
    await db.query("INSERT INTO client_daily_metrics (client_id, tracked_date, notes) VALUES ('client-a', '2026-10-06', 'Old app payload') ON CONFLICT (client_id, tracked_date) DO UPDATE SET notes = EXCLUDED.notes");
    const { rows } = await db.query<{ client_id: string; date: string; manual_steps: number | null }>("SELECT client_id, tracked_date::text AS date, manual_steps FROM client_daily_metrics ORDER BY client_id, tracked_date");
    assert.deepEqual(rows, [
      { client_id: "client-a", date: "2026-10-06", manual_steps: 8000 },
      { client_id: "client-a", date: "2026-10-07", manual_steps: 0 },
      { client_id: "client-b", date: "2026-10-07", manual_steps: null },
    ]);
    await assert.rejects(db.query("UPDATE client_daily_metrics SET manual_steps = -1 WHERE client_id = 'client-a'"), /manual_steps_nonnegative/);
    await db.query("UPDATE client_daily_metrics SET manual_steps = NULL WHERE client_id = 'client-a' AND tracked_date = '2026-10-07'");
    const cleared = await db.query<{ manual_steps: number | null }>("SELECT manual_steps FROM client_daily_metrics WHERE client_id = 'client-a' AND tracked_date = '2026-10-07'");
    assert.equal(cleared.rows[0].manual_steps, null);
  } finally {
    await db.close();
  }
});

test("the coaching date agrees across device timezones at UK midnight and DST changes", () => {
  assert.equal(coachingDateKey(new Date("2026-10-07T23:30:00Z")), "2026-10-08");
  assert.equal(coachingDateKey(new Date("2026-10-07T12:00:00+14:00")), "2026-10-06");
  assert.equal(coachingDateKey(new Date("2026-03-29T23:30:00Z")), "2026-03-30");
  assert.equal(coachingDateKey(new Date("2026-10-25T23:30:00Z")), "2026-10-25");
});

test("tracker dates use the requested local timezone across midnight and DST", () => {
  assert.equal(coachingDateKey(new Date("2026-11-03T03:42:00Z"), "America/Chicago"), "2026-11-02");
  assert.equal(coachingDateKey(new Date("2026-11-03T03:42:00Z"), "Pacific/Auckland"), "2026-11-03");
  assert.equal(coachingDateKey(new Date("2026-11-02T12:30:00Z"), "Pacific/Kiritimati"), "2026-11-03");
  assert.equal(coachingDateKey(new Date("2026-11-01T06:30:00Z"), "America/New_York"), "2026-11-01");
  assert.equal(coachingDateKey(new Date("2026-11-01T07:30:00Z"), "America/New_York"), "2026-11-01");
  assert.equal(trackerTimeZone(undefined), "Europe/London");
  for (const value of ["Mars/Olympus", 123, {}, "x".repeat(101)]) assert.equal(trackerTimeZone(value), null);
  assert.equal(trackerTimeZone("America/Chicago"), "America/Chicago");
});
