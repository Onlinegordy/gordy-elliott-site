import { shouldUseSetLogging } from "@/lib/exercise-prescriptions";
import type { WorkoutSetData } from "@/lib/workout-runner";
import type { ExerciseSessionItem } from "@/lib/types";

export type HistoryItem = Pick<ExerciseSessionItem, "id" | "session_id" | "exercise_id" | "order_index" | "section_label" | "prescription_type"> & { day_number: number };
export type HistoryLog = { id: string; exercise_item_id: string; log_date: string; completed: boolean; performed_exercise_id?: string | null; sets_data: unknown };
export type PreviousExerciseLoad = { date: string; weights: Record<number, string> };
export type PreviousExerciseLoads = Record<string, PreviousExerciseLoad>;

function weightsFromLog(log: HistoryLog): Record<number, string> {
  const weights: Record<number, string> = {};
  if (!Array.isArray(log.sets_data)) return weights;
  for (const [index, value] of log.sets_data.entries()) {
    if (!value || typeof value !== "object") continue;
    const set = value as Record<string, unknown>;
    if (!(typeof set.completed === "boolean" ? set.completed : log.completed)) continue;
    const weight = typeof set.weight === "string" || typeof set.weight === "number" ? String(set.weight).trim() : "";
    if (!weight || !Number.isFinite(Number(weight)) || Number(weight) < 0) continue;
    const number = typeof set.set_number === "number" && Number.isInteger(set.set_number) && set.set_number > 0 ? set.set_number : index + 1;
    weights[number] = weight;
  }
  return weights;
}

/** Match identity, never exercise names; copied programme weeks have new item IDs. */
export function previousExerciseLoads(targets: HistoryItem[], items: HistoryItem[], logs: HistoryLog[], before: string): PreviousExerciseLoads {
  const byId = new Map(items.map(item => [item.id, item]));
  const sections = new Map<string, string>();
  const occurrences = new Map<string, number>();
  const sessions = new Map<string, HistoryItem[]>();
  for (const item of items) sessions.set(item.session_id, [...(sessions.get(item.session_id) || []), item]);
  for (const sessionItems of sessions.values()) {
    let section = "";
    const counts = new Map<string, number>();
    for (const item of [...sessionItems].sort((a, b) => a.order_index - b.order_index || a.id.localeCompare(b.id))) {
      // Stored labels mark boundaries; the remaining exercises inherit that section.
      if (item.section_label?.trim()) section = item.section_label.trim().toLowerCase();
      sections.set(item.id, section);
      const key = `${section}:${item.exercise_id}`;
      occurrences.set(item.id, counts.get(key) || 0);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  const sorted = [...logs].filter(log => log.log_date < before).sort((a, b) => b.log_date.localeCompare(a.log_date) || b.id.localeCompare(a.id));
  const result: PreviousExerciseLoads = {};
  for (const target of targets) {
    if (!shouldUseSetLogging(target)) continue;
    const matches = sorted.filter(log => {
      const source = byId.get(log.exercise_item_id);
      return source && shouldUseSetLogging(source) && (log.performed_exercise_id || source.exercise_id) === target.exercise_id
        && source.exercise_id === target.exercise_id && (source.id === target.id || (
          source.day_number === target.day_number && sections.get(source.id) === sections.get(target.id) && occurrences.get(source.id) === occurrences.get(target.id)
        ));
    });
    // Keep this slot's own history ahead of other occurrences of the movement.
    matches.sort((a, b) => Number(b.exercise_item_id === target.id) - Number(a.exercise_item_id === target.id));
    for (const log of matches) {
      const weights = weightsFromLog(log);
      if (Object.keys(weights).length) { result[target.id] = { date: log.log_date, weights }; break; }
    }
  }
  return result;
}

/** A restored nonempty weight may be explicitly entered, even if equal to history. */
export function previousWeightsForRestoredDraft(drafts: Record<string, WorkoutSetData[]>, previous: PreviousExerciseLoads): PreviousExerciseLoads {
  return Object.fromEntries(Object.entries(previous).flatMap(([id, load]) => {
    const weights = Object.fromEntries(Object.entries(load.weights).filter(([number]) => {
      const set = drafts[id]?.find(set => set.set_number === Number(number));
      return set && set.weight === "" && !set.reps && !set.notes && !set.completed;
    }));
    return Object.keys(weights).length ? [[id, { ...load, weights }]] : [];
  }));
}

/** Historical loads are editable starting values, never completed sets or copied reps. */
export function prefillPreviousWeights(drafts: Record<string, WorkoutSetData[]>, previous: PreviousExerciseLoads): Record<string, WorkoutSetData[]> {
  return Object.fromEntries(Object.entries(drafts).map(([id, sets]) => [id, sets.map(set => {
    const weight = previous[id]?.weights[set.set_number];
    return weight !== undefined && set.weight === "" && !set.reps && !set.notes && !set.completed ? { ...set, weight } : set;
  })]));
}

/** Untouched historical defaults are not work entered in this session. */
export function hasCurrentWorkoutValues(sets: WorkoutSetData[], previous?: PreviousExerciseLoad) {
  return sets.some(set => set.completed || Boolean(set.reps || set.notes) || Boolean(set.weight && set.weight !== previous?.weights[set.set_number]));
}

/** Remove the default's provenance after any explicit weight input or exercise reset. */
export function forgetPreviousWeights(previous: PreviousExerciseLoads, itemId: string, setNumber?: number): PreviousExerciseLoads {
  if (!previous[itemId]) return previous;
  const next = { ...previous };
  if (setNumber === undefined) { delete next[itemId]; return next; }
  const weights = { ...previous[itemId].weights };
  delete weights[setNumber];
  if (Object.keys(weights).length) next[itemId] = { ...previous[itemId], weights };
  else delete next[itemId];
  return next;
}

/** Reindex only surviving provenance when an extra row is removed. */
export function removeSetFromPreviousWeights(previous: PreviousExerciseLoads, itemId: string, sets: WorkoutSetData[], index: number): PreviousExerciseLoads {
  const original = previous[itemId];
  if (!original || !Number.isInteger(index) || index < 0 || index >= sets.length) return previous;
  const weights: Record<number, string> = {};
  sets.filter((_, position) => position !== index).forEach((set, position) => {
    const weight = original.weights[set.set_number];
    if (weight !== undefined) weights[position + 1] = weight;
  });
  const result = { ...previous };
  if (Object.keys(weights).length) result[itemId] = { ...original, weights };
  else delete result[itemId];
  return result;
}
