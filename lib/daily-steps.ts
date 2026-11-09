const MAX_STEPS = 2_147_483_647;

function isStepCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= MAX_STEPS;
}

export function parseManualSteps(value: unknown): { value: number | null; error?: never } | { error: string; value?: never } {
  if (value === undefined || value === null || (typeof value === "string" && value.trim() === "")) {
    return { value: null };
  }
  const parsed = typeof value === "string" && /^\d+$/.test(value.trim()) ? Number(value.trim()) : value;
  if (!isStepCount(parsed)) return { error: "Steps must be a whole number of 0 or more." };
  return { value: parsed };
}

/** A manual total replaces the synced total for the same date; the two are never added. */
export function resolveDailySteps(manualSteps: unknown, syncedSteps: unknown): {
  value: number | null;
  source: "manual" | "synced" | null;
} {
  if (isStepCount(manualSteps)) return { value: manualSteps, source: "manual" };
  if (isStepCount(syncedSteps)) return { value: syncedSteps, source: "synced" };
  return { value: null, source: null };
}

export function isValidTrackerDate(value: unknown, latestDate: string): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value > latestDate) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** Missing timezone retains compatibility with older apps; invalid zones are rejected. */
export function trackerTimeZone(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return "Europe/London";
  if (typeof value !== "string" || value.length > 100) return null;
  try { new Intl.DateTimeFormat("en", { timeZone: value }); return value; } catch { return null; }
}

export function coachingDateKey(now = new Date(), timeZone = "Europe/London") {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  return `${parts.find((part) => part.type === "year")!.value}-${parts.find((part) => part.type === "month")!.value}-${parts.find((part) => part.type === "day")!.value}`;
}
