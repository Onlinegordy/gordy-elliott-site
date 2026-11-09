// Shared by runtime AI routes and the offline knowledge-ingestion scripts.
export const AI_CONTEXT_POLICY = "garmin-excluded-2026-11-09";

const SAFE_WEARABLE_PROVIDERS = new Set(["myfitnesspal", "oura", "whoop", "fitbit"]);
const MANUAL_GUIDANCE_SOURCES = new Set(["gordy_direct", "client_session_distilled"]);
const providerKey = value => typeof value === "string" ? value.toLowerCase().replace(/[^a-z0-9]/g, "") : "";

export function isAiSafeWearableProvider(value) {
  // Phone-health aggregators can contain imported Garmin readings. Until the
  // original source is retained and verified, they are not an AI-safe origin.
  return SAFE_WEARABLE_PROVIDERS.has(providerKey(value));
}

/** Inspect explicit machine-source metadata, not words in human conversation. */
export function hasExcludedMachineProvenance(value) {
  if (typeof value === "string") {
    if (!/^[\s]*[\[{]/.test(value)) return false;
    try { return hasExcludedMachineProvenance(JSON.parse(value)); } catch { return false; }
  }
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(hasExcludedMachineProvenance);
  for (const [key, source] of Object.entries(value)) {
    const normalized = key.toLowerCase().replace(/[^a-z]/g, "");
    if (["providers", "sourceproviders", "originproviders"].includes(normalized)) {
      if (!Array.isArray(source) || !source.length || !source.every(isAiSafeWearableProvider)) return true;
    }
    if (["provider", "sourceprovider", "originprovider"].includes(normalized) && !isAiSafeWearableProvider(source)) return true;
    if (["sourcetype", "sourceapp", "provenance"].includes(normalized) && providerKey(source).includes("garmin")) return true;
    if (hasExcludedMachineProvenance(source)) return true;
  }
  return false;
}

export function isAiSafeWearableSummary(summary) {
  return Boolean(summary && Array.isArray(summary.providers) && summary.providers.length
    && summary.providers.every(isAiSafeWearableProvider) && !hasExcludedMachineProvenance(summary));
}

export function isAiSafeGuidance(doc) {
  return Boolean(doc && MANUAL_GUIDANCE_SOURCES.has(doc.provenance) && !hasExcludedMachineProvenance(doc));
}

export function aiConversationHistory(history) {
  if (!Array.isArray(history)) return [];
  return history.flatMap(turn => {
    if (!turn || typeof turn.content !== "string") return [];
    if (turn.role !== "user" && !(turn.role === "assistant" && turn.contextPolicy === AI_CONTEXT_POLICY)) return [];
    if (hasExcludedMachineProvenance(turn.content)) return [];
    return [{ role: turn.role, content: turn.content }];
  });
}

export function assertAiSourceAllowed(value) {
  if (hasExcludedMachineProvenance(value)) throw new Error("Imported Garmin or unverified machine-source data cannot be sent to AI.");
}

/** These fields are entered as ratings, not copied from the wearable feed. */
export function aiManualDailyRatings(row) {
  if (!row || hasExcludedMachineProvenance(row)) return null;
  return Object.fromEntries(["tracked_date", "energy_level", "stress_level", "nutrition_score", "training_completed"]
    .filter(key => Object.hasOwn(row, key)).map(key => [key, row[key]]));
}
