import type { SupabaseClient } from "@supabase/supabase-js";
import { isAiSafeWearableProvider, isAiSafeWearableSummary } from "@/lib/ai-source-policy.mjs";
import { sanitizeWearableRecovery, type WearableDailySummary } from "@/lib/wearable-insights";

/** Never forward a stored blended score merely because its latest feed is safe. */
export async function aiWearableSummaries(admin: SupabaseClient, rows: WearableDailySummary[]) {
  const candidates = rows.filter(isAiSafeWearableSummary);
  const ids = [...new Set(candidates.flatMap(row => row.source_payload_ids || []))];
  if (!ids.length) return [];
  const sources = new Map<string, { client_id: string; provider: string }>();
  for (let offset = 0; offset < ids.length; offset += 100) {
    const { data, error } = await admin.from("client_wearable_events")
      .select("id,client_id,provider").in("id", ids.slice(offset, offset + 100));
    // Lookup failure or expired/missing provenance must never open an AI path.
    if (error) return [];
    for (const event of data || []) sources.set(event.id, event);
  }
  return candidates.filter(row => Boolean(row.client_id && row.source_payload_ids?.length
    && row.source_payload_ids.every(id => {
      const event = sources.get(id);
      return Boolean(event && event.client_id === row.client_id && isAiSafeWearableProvider(event.provider)
        && row.providers.some(provider => provider.toLowerCase() === event.provider.toLowerCase()));
    }))).map(sanitizeWearableRecovery);
}
