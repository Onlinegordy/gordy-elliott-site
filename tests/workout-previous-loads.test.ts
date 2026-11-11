import assert from "node:assert/strict";
import test from "node:test";
import { previousWeightsForRestoredDraft, previousExerciseLoads, prefillPreviousWeights, hasCurrentWorkoutValues, forgetPreviousWeights, removeSetFromPreviousWeights, type HistoryItem, type HistoryLog } from "@/lib/workout-previous-loads";
import { buildNativeWorkoutLaunchPayload } from "@/lib/native-workout";
import type { ExerciseSession } from "@/lib/types";

const old: HistoryItem = { id: "week1-item", session_id: "week1", exercise_id: "bench", order_index: 1, day_number: 1 };
const current: HistoryItem = { ...old, id: "week2-item", session_id: "week2" };
const set = (number: number, weight = "", completed = false) => ({ set_number: number, weight, reps: "", notes: "", completed });
const log = (id: string, item: string, date: string, weight: string, extra: Partial<HistoryLog> = {}): HistoryLog => ({ id, exercise_item_id: item, log_date: date, completed: true, sets_data: [{ ...set(1, weight, true), reps: "8" }], ...extra });

test("new programme-week IDs still pick up previous loads without visiting the old week", () => {
  const history = previousExerciseLoads([current], [old, current], [log("last", old.id, "2026-10-12", "62.5")], "2026-10-19");
  assert.deepEqual(history[current.id], { date: "2026-10-12", weights: { 1: "62.5" } });
  const drafts = prefillPreviousWeights({ [current.id]: [set(1), set(2)] }, history);
  assert.deepEqual(drafts[current.id], [set(1, "62.5"), set(2)]);
});

test("static-plan history, zero load and set numbers survive; latest comparable completed work wins", () => {
  const rows = [log("old", old.id, "2026-10-05", "20"), log("latest", old.id, "2026-10-12", "0", { sets_data: [set(1, "0", true), set(2, "22.5", true), set(3, "100", false)] }), log("future", old.id, "2026-10-20", "200"), log("same-day", old.id, "2026-10-19", "150")];
  assert.deepEqual(previousExerciseLoads([old], [old], rows, "2026-10-19")[old.id], { date: "2026-10-12", weights: { 1: "0", 2: "22.5" } });
});

test("different exercises, substitutions, session slots and repeated warm-up movements cannot contaminate loads", () => {
  const second = { ...old, id: "second", order_index: 2 };
  const secondCurrent = { ...current, id: "second-current", order_index: 2 };
  const differentDay = { ...old, id: "day2", session_id: "day2", day_number: 2 };
  const differentExercise = { ...old, id: "other", exercise_id: "other-bench" };
  const history = previousExerciseLoads([current, secondCurrent], [old, second, current, secondCurrent, differentDay, differentExercise], [
    log("first", old.id, "2026-10-12", "20"), log("second", second.id, "2026-10-12", "60"),
    log("day2", differentDay.id, "2026-10-18", "80"), log("other", differentExercise.id, "2026-10-18", "90"),
    log("swapped", old.id, "2026-10-18", "100", { performed_exercise_id: "dumbbell-press" }),
  ], "2026-10-19");
  assert.equal(history[current.id].weights[1], "20");
  assert.equal(history[secondCurrent.id].weights[1], "60");
});

test("custom circuits and malformed or incomplete weights never become defaults", () => {
  const timed = { ...current, prescription_type: "time" as const };
  const history = previousExerciseLoads([current, timed], [old, current], [log("bad", old.id, "2026-10-12", "NaN"), log("partial", old.id, "2026-10-13", "80", { sets_data: [set(1, "80", false)] })], "2026-10-19");
  assert.deepEqual(history, {});
});

test("saved edits, typed values, notes and completion are never overwritten by delayed history", () => {
  const drafts = { item: [set(1, "75", true), { ...set(2), reps: "10" }, { ...set(3), notes: "bodyweight today" }, set(4)] };
  const result = prefillPreviousWeights(drafts, { item: { date: "2026-10-12", weights: { 1: "60", 2: "60", 3: "60", 4: "60" } } });
  assert.deepEqual(result.item.slice(0, 3), drafts.item.slice(0, 3));
  assert.deepEqual(result.item[3], set(4, "60"));
});

test("existing native bridge carries the same prefilled load with reps and completion clear", () => {
  const session: ExerciseSession = { id: "week2", name: "Upper body", day_number: 1, items: [{ ...current, sets: 2, reps: "8", exercise: { id: "bench", name: "Bench press", muscle_group: "Chest", equipment: "Barbell", is_active: true, created_at: "2026-10-01" } }] };
  const drafts = prefillPreviousWeights({ [current.id]: [set(1), set(2)] }, { [current.id]: { date: "2026-10-12", weights: { 1: "60", 2: "62.5" } } });
  const payload = buildNativeWorkoutLaunchPayload({ session, date: "2026-10-19", dateLabel: "Today", mode: "workout", sets: drafts, startedAt: null });
  assert.deepEqual(payload.sets[current.id], [set(1, "60"), set(2, "62.5")]);
});

import { loadPreviousExerciseLoads } from "@/lib/workout-previous-loads-server";
import type { SupabaseClient } from "@supabase/supabase-js";

test("server lookup scopes other clients out and reads past the default 1000-log page", async () => {
  type Row = Record<string, unknown>;
  const tables: Record<string, Row[]> = {
    client_exercise_sessions: [{ id: "week1", plan_id: "plan-a", day_number: 1 }, { id: "week2", plan_id: "plan-a", day_number: 1 }, { id: "other-session", plan_id: "plan-b", day_number: 1 }],
    client_exercise_session_items: [old, current, { ...old, id: "other-item", session_id: "other-session" }],
    client_exercise_logs: [
      ...Array.from({ length: 1005 }, (_, i) => ({ ...log(String(i).padStart(6, "0"), old.id, "2026-10-12", i === 0 ? "62.5" : ""), client_id: "client-a" })),
      { ...log("other-client", old.id, "2026-10-18", "999"), client_id: "client-b" },
    ],
  };
  const logPages: number[] = [];
  const admin = { from(table: string) {
    let rows = [...tables[table]];
    const orders: Array<{ field: string; ascending: boolean }> = [];
    let start = 0, end = 999;
    const query = {
      select() { return query; },
      eq(field: string, value: unknown) { rows = rows.filter(row => row[field] === value); return query; },
      in(field: string, values: unknown[]) { rows = rows.filter(row => values.includes(row[field])); return query; },
      lt(field: string, value: string) { rows = rows.filter(row => String(row[field]) < value); return query; },
      gte(field: string, value: string) { rows = rows.filter(row => String(row[field]) >= value); return query; },
      order(field: string, options: { ascending: boolean }) { orders.push({ field, ...options }); return query; },
      range(from: number, to: number) { start = from; end = to; if (table === "client_exercise_logs") logPages.push(from); return query; },
      then(resolve: (value: { data: Row[]; error: null }) => unknown) {
        rows.sort((a, b) => { for (const { field, ascending } of orders) { const diff = String(a[field]).localeCompare(String(b[field])); if (diff) return ascending ? diff : -diff; } return 0; });
        return Promise.resolve({ data: rows.slice(start, end + 1), error: null }).then(resolve);
      },
    };
    return query;
  } } as unknown as SupabaseClient;
  const result = await loadPreviousExerciseLoads(admin, "client-a", "plan-a", "week2", "2026-10-19");
  assert.equal(result[current.id].weights[1], "62.5");
  assert.deepEqual(logPages, [0, 1000]);
});


test("untouched previous loads keep swaps available, while current work and fresh substitute loads lock them", () => {
  const previous = { date: "2026-10-12", weights: { 1: "60", 2: "62.5" } };
  assert.equal(hasCurrentWorkoutValues([set(1, "60"), set(2, "62.5")], previous), false);
  assert.equal(hasCurrentWorkoutValues([set(1, "65")], previous), true);
  assert.equal(hasCurrentWorkoutValues([{ ...set(1, "60"), reps: "8" }], previous), true);
  assert.equal(hasCurrentWorkoutValues([set(1, "60", true)], previous), true);
  assert.equal(hasCurrentWorkoutValues([set(1, "60")]), true);
});


test("explicit input equal to history and swap-then-keep-original cannot regain a default exemption", () => {
  const previous = { item: { date: "2026-10-12", weights: { 1: "60", 2: "62.5" } } };
  const afterTypingSameWeight = forgetPreviousWeights(previous, "item", 1);
  assert.equal(hasCurrentWorkoutValues([set(1, "60"), set(2, "62.5")], afterTypingSameWeight.item), true);
  assert.equal(previous.item.weights[1], "60");
  const afterSwap = forgetPreviousWeights(previous, "item");
  assert.deepEqual(afterSwap, {});
  assert.equal(hasCurrentWorkoutValues([set(1, "60")], afterSwap.item), true);
});


test("sparse section boundaries inherit correctly when a copied week inserts another exercise first", () => {
  const previousBench = { ...old, section_label: "Main" };
  const inserted = { ...current, id: "inserted", exercise_id: "row", order_index: 0, section_label: "Main" };
  const newBench = { ...current, section_label: undefined };
  const history = previousExerciseLoads([newBench], [previousBench, inserted, newBench], [log("last", old.id, "2026-10-12", "60")], "2026-10-19");
  assert.equal(history[current.id].weights[1], "60");
});

test("unlabelled warm-up and working exercises in different effective sections cannot share loads", () => {
  const previousHeader = { ...old, id: "old-header", exercise_id: "row", order_index: 0, section_label: "Warm up" };
  const currentHeader = { ...current, id: "new-header", exercise_id: "row", order_index: 0, section_label: "Main" };
  assert.deepEqual(previousExerciseLoads([current], [previousHeader, old, currentHeader, current], [log("last", old.id, "2026-10-12", "20")], "2026-10-19"), {});
});

test("removing a blank added set preserves historical defaults and keeps exercise swapping available",()=>{
 const previous={item:{date:"2026-10-12",weights:{1:"60",2:"62.5",3:"65"}}};
 const sets=[set(1,"60"),set(2,"62.5"),set(3,"65"),set(4)];
 const result=removeSetFromPreviousWeights(previous,"item",sets,3);
 assert.deepEqual(result,previous);
 assert.equal(hasCurrentWorkoutValues(sets.slice(0,3),result.item),false);
});
test("removing an extra row reindexes only surviving provenance, preserving typed work as typed",()=>{
 const previous={item:{date:"2026-10-12",weights:{1:"60",3:"65",4:"70",5:"75"}}};
 const sets=[set(1,"60"),set(2,"62.5"),set(3,"65"),set(4,"70"),set(5,"75")];
 const result=removeSetFromPreviousWeights(previous,"item",sets,3);
 assert.deepEqual(result.item,{date:"2026-10-12",weights:{1:"60",3:"65",4:"75"}});
 assert.equal(hasCurrentWorkoutValues(sets.filter((_,i)=>i!==3).map((s,i)=>({...s,set_number:i+1})),result.item),true);
 assert.equal(removeSetFromPreviousWeights(previous,"missing",sets,3),previous);
});

test("actual workout page hydrates history after direct start and local draft resume, but never in edit mode or over saved sessions", async () => {
  const { readFile } = await import("node:fs/promises");
  const ts = await import("typescript");
  const source = await readFile(new URL("../app/portal/exercise-plan/page.tsx", import.meta.url), "utf8");
  const ast = ts.createSourceFile("page.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let expression = "";
  function visit(node: import("typescript").Node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "needsPreviousLoads") expression = node.initializer!.getText(ast);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(expression, "use the page's actual history gate");
  const compiled = ts.transpileModule(`module.exports = (${expression});`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const check = new Function("runnerOpen", "runnerMode", "sessionStartedAt", "resumedDraftKey", "previousLoadsKey", "dayLogs", "activeSession", `const module = {exports:false}; ${compiled}; return module.exports;`);
  for (const [timer, resume] of [[null, null], [12345, null], [12345, "workout:2026-11-11"]]) {
    assert.equal(check(true, "workout", timer, resume, "workout:2026-11-11", [], { id: "workout" }), true);
    assert.equal(check(true, "edit", timer, resume, "workout:2026-11-11", [], { id: "workout" }), false);
    assert.equal(check(false, "workout", timer, resume, "workout:2026-11-11", [], { id: "workout" }), false);
    assert.equal(check(true, "workout", timer, resume, "workout:2026-11-11", [{ session_id: "workout" }], { id: "workout" }), false);
  }
});


test("resumed explicit weights equal to history remain current work and keep swaps locked", () => {
  const history = { item: { date: "2026-11-04", weights: { 1: "60", 2: "62.5" } } };
  const restored = { item: [set(1, "60"), set(2)] };
  const defaults = previousWeightsForRestoredDraft(restored, history);
  assert.deepEqual(defaults.item.weights, { 2: "62.5" });
  const drafts = prefillPreviousWeights(restored, defaults);
  assert.deepEqual(drafts.item, [set(1, "60"), set(2, "62.5")]);
  assert.equal(hasCurrentWorkoutValues(drafts.item, defaults.item), true);
  assert.equal(hasCurrentWorkoutValues(prefillPreviousWeights({ item: [set(1), set(2)] }, history).item, history.item), false);
});
