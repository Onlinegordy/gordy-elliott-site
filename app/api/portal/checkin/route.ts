import { scheduledCheckinDates, scheduledCheckinError, checkinWeekStart, addCheckinDays, checkinToday } from "@/lib/checkin-schedule";
import { foundationsMidnight } from "@/lib/foundations";
import { monthlyReviewWindow } from "@/lib/foundations";
import { checkinConfigForWeightUnit, isWeightUnit, weightToKg } from "@/lib/weight-units";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { buildFallbackCheckinConfig, normalizeCheckinConfig, validateCheckinSubmission } from "@/lib/checkin-form";
import { loadCoachCheckinReplies } from "@/lib/checkin-replies";
import { checkinConfigRevision } from "@/lib/checkin-revision";
import { NextResponse } from "next/server";

async function resolveCheckinConfig(admin: ReturnType<typeof createAdminClient>, profile: { checkin_form_id: string | null; programme_type?: string }) {
  const { data: assigned } = profile.checkin_form_id ? await admin.from("checkin_forms").select("id, name, config").eq("id", profile.checkin_form_id).maybeSingle() : { data: null };
  if (profile.programme_type === "boardroom") {
    // Only Gordy's explicit personal assignment unlocks submission; never a global fitness default.
    const approved = assigned?.config?.programme_type === "boardroom";
    return { config: approved ? normalizeCheckinConfig(assigned.config, "boardroom") : null, template: approved ? assigned : null, pending: !approved };
  }
  const { data: defaultTemplate } = assigned ? { data: null } : await admin.from("checkin_forms").select("id, name, config").eq("is_default", true).order("created_at", { ascending: true }).limit(1).maybeSingle();
  const template = assigned || defaultTemplate;
  if (template?.config?.programme_type === "boardroom") return { config: null, template: null, pending: true };
  if (template?.config) return { config: normalizeCheckinConfig(template.config), template, pending: false };
  const { data: legacy } = await admin.from("form_config").select("config").eq("form_type", "checkin").maybeSingle();
  return { config: legacy?.config ? normalizeCheckinConfig(legacy.config) : buildFallbackCheckinConfig(), template: null, pending: false };
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("client_profiles")
    .select("id, tier, programme_type, start_date, weight_unit, checkin_day, last_checkin, checkin_form_id")
    .eq("user_id", user.id)
    .single();

  if (!profile) {
    return NextResponse.json({ error: "Client profile not found" }, { status: 404 });
  }

  const { config: effectiveConfig, template: effectiveTemplate, pending } = await resolveCheckinConfig(admin, profile);

  const dates=scheduledCheckinDates(profile.start_date,profile.checkin_day||effectiveConfig?.checkin_day);
  const selectedDate=new URL(request.url).searchParams.get("date")||dates[0]||null;
  const editId = new URL(request.url).searchParams.get("edit");
  if(!editId&&selectedDate&&scheduledCheckinError(selectedDate,dates))return NextResponse.json({error:scheduledCheckinError(selectedDate,dates)},{status:400});
  let query = admin.from("checkins").select("*").eq("client_id", profile.id);
  query = editId ? query.eq("id", editId) : selectedDate ? query.or(`scheduled_date.eq.${selectedDate},and(scheduled_date.is.null,created_at.gte.${foundationsMidnight(checkinWeekStart(selectedDate))},created_at.lt.${foundationsMidnight(addCheckinDays(checkinWeekStart(selectedDate),7))})`) : query.eq("id","00000000-0000-0000-0000-000000000000");
  const { data: currentWeekCheckin, error: loadError } = await query.order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (loadError) return NextResponse.json({ error: "Couldn't load your check-in" }, { status: 500 });
  if (editId && !currentWeekCheckin) return NextResponse.json({ error: "Check-in not found" }, { status: 404 });
  const snapshot = currentWeekCheckin?.form_config_snapshot;
  if (currentWeekCheckin && (snapshot?.programme_type === "boardroom") !== (profile.programme_type === "boardroom")) return NextResponse.json({ error: "This check-in belongs to your previous programme. Ask Gordy to review it." }, { status: 409 });
  const baseConfig = snapshot ? normalizeCheckinConfig(snapshot, profile.programme_type === "boardroom" ? "boardroom" : undefined) : effectiveConfig;
  // Old check-ins retain their original unit, regardless of a later preference change.
  const savedUnit = currentWeekCheckin?.responses?.weight_unit || snapshot?.progress_tracking?.find((m: { id: string }) => m.id === "weight")?.unit || "kg";
  const weightUnit = currentWeekCheckin ? (isWeightUnit(savedUnit) ? savedUnit : "kg") : (isWeightUnit(profile.weight_unit) ? profile.weight_unit : "kg");
  const displayedConfig = baseConfig ? checkinConfigForWeightUnit(baseConfig, weightUnit) : null;
  const displayedTemplateId = snapshot ? currentWeekCheckin.checkin_form_id : effectiveTemplate?.id || profile.checkin_form_id || null;
  const { data: history } = await admin.from("checkins").select("id, created_at, week_number, scheduled_date").eq("client_id", profile.id).order("created_at", { ascending: false }).limit(52);

  const replies = await loadCoachCheckinReplies(admin, profile.id, profile.tier || "coached");

  let monthlyReview = null;
  if (profile.programme_type === "foundations") {
    const { data: reviews } = await admin.from("foundations_monthly_reviews").select("response,period_start,period_end,reviewed_at,message_id").eq("client_id", profile.id).order("period_start", { ascending: false }).limit(1);
    monthlyReview = { ...monthlyReviewWindow(profile.start_date), latest: reviews?.[0] || null };
  }
  return NextResponse.json({
    monthlyReview,
    scheduledDates:dates,
    scheduledDate:currentWeekCheckin?.scheduled_date || selectedDate,
    currentWeekCheckin: currentWeekCheckin || null,
    checkinReplies: replies.replies,
    repliesUnavailable: replies.unavailable,
    checkinDay: profile.checkin_day || null,
    lastCheckin: profile.last_checkin || null,
    config: displayedConfig,
    configRevision: displayedConfig ? checkinConfigRevision(displayedConfig, displayedTemplateId) : null,
    pending: !displayedConfig && pending,
    history: history || [],
    editingHistory: Boolean(editId),
    weightUnit,
    programmeType: profile.programme_type,
    templateId: effectiveTemplate?.id || profile.checkin_form_id || null,
    templateName: effectiveTemplate?.name || null,
  });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const admin = createAdminClient();

  const { data: profile } = await admin
    .from("client_profiles")
    .select("id, programme_type, weight_unit, checkin_form_id, start_date, checkin_day")
    .eq("user_id", user.id)
    .single();

  if (!profile) {
    return NextResponse.json({ error: "Client profile not found" }, { status: 404 });
  }

  const { config, template } = await resolveCheckinConfig(admin, profile);

  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid request" }, { status: 400 }); }
  if (body.checkin_id !== undefined && typeof body.checkin_id !== "string") return NextResponse.json({ error: "Invalid check-in" }, { status: 400 });
  const dates=scheduledCheckinDates(profile.start_date,profile.checkin_day||config?.checkin_day);
  const selectedDate=body.scheduled_date||dates[0]||null;
  if(!body.checkin_id&&scheduledCheckinError(selectedDate,dates))return NextResponse.json({error:scheduledCheckinError(selectedDate,dates)},{status:400});
  let query = admin.from("checkins").select("id, created_at, week_number, checkin_form_id, form_config_snapshot, responses, wins, challenges, questions, scheduled_date").eq("client_id", profile.id);
  query = body.checkin_id ? query.eq("id", body.checkin_id) : query.or(`scheduled_date.eq.${selectedDate},and(scheduled_date.is.null,created_at.gte.${foundationsMidnight(checkinWeekStart(selectedDate))},created_at.lt.${foundationsMidnight(addCheckinDays(checkinWeekStart(selectedDate),7))})`);
  const { data: currentWeekCheckin, error: loadError } = await query.order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (loadError) return NextResponse.json({ error: "Couldn't load your saved check-in. Nothing was changed." }, { status: 500 });
  if (body.checkin_id && !currentWeekCheckin) return NextResponse.json({ error: "Check-in not found" }, { status: 404 });
  if(body.checkin_id&&body.scheduled_date&&currentWeekCheckin?.scheduled_date&&body.scheduled_date!==currentWeekCheckin.scheduled_date)return NextResponse.json({error:"A saved check-in stays on its original scheduled date."},{status:409});
  if(currentWeekCheckin&&!body.checkin_id)return NextResponse.json({error:"This scheduled check-in is already saved. Reopen it to edit without replacing another submission."},{status:409});
  const snapshot = currentWeekCheckin?.form_config_snapshot;
  if (currentWeekCheckin && (snapshot?.programme_type === "boardroom") !== (profile.programme_type === "boardroom")) return NextResponse.json({ error: "This check-in belongs to your previous programme. Ask Gordy to review it." }, { status: 409 });
  const baseConfig = snapshot ? normalizeCheckinConfig(snapshot, profile.programme_type === "boardroom" ? "boardroom" : undefined) : config;
  if (!baseConfig) return NextResponse.json({ error: "Gordy is preparing your personal check-in." }, { status: 409 });
  if (body.weight_unit !== undefined && !isWeightUnit(body.weight_unit)) return NextResponse.json({ error: "Choose kg or lb" }, { status: 400 });
  const previousUnit = baseConfig.progress_tracking?.find(m => m.id === "weight")?.unit;
  const savedUnit = currentWeekCheckin?.responses?.weight_unit || previousUnit;
  const weightUnit = body.weight_unit || (currentWeekCheckin
    ? (isWeightUnit(savedUnit) ? savedUnit : "kg")
    : (isWeightUnit(profile.weight_unit) ? profile.weight_unit : isWeightUnit(previousUnit) ? previousUnit : "kg"));
  const submittedConfig = checkinConfigForWeightUnit(baseConfig, weightUnit);
  const submittedTemplateId = snapshot ? currentWeekCheckin.checkin_form_id : template?.id || null;
  if (profile.programme_type === "boardroom" && body.config_revision !== checkinConfigRevision(submittedConfig, submittedTemplateId)) {
    return NextResponse.json({ error: "Your check-in form changed while it was open. Keep a copy of your answers, then reload to use the updated questions.", code: "CHECKIN_FORM_CHANGED" }, { status: 409 });
  }
  const submitted = validateCheckinSubmission(submittedConfig, body.mood, body.responses);
  if (submitted.error) return NextResponse.json({ error: submitted.error }, { status: 400 });
  const mood = submitted.mood || "okay";
  if (profile.programme_type !== "boardroom" && body.responses?.weight && (!Number.isFinite(Number(body.responses.weight)) || Number(body.responses.weight) <= 0)) return NextResponse.json({ error: "Enter a valid positive weight and select kg or lb" }, { status: 400 });
  // Preserve existing fitness answer keys; business submissions use only their assigned schema.
  const legacyAnswers = { wins: currentWeekCheckin?.wins || null, challenges: currentWeekCheckin?.challenges || null, questions: currentWeekCheckin?.questions || null };
  const responses: Record<string, unknown> = profile.programme_type === "boardroom" ? submitted.responses : { ...legacyAnswers, ...currentWeekCheckin?.responses, ...body.responses, ...submitted.responses, weight_unit: weightUnit };
  const previousWeightUnit = currentWeekCheckin?.responses?.weight_unit || snapshot?.progress_tracking?.find((m: { id: string }) => m.id === "weight")?.unit || "kg";
  const weightChanged = !currentWeekCheckin || responses.weight !== currentWeekCheckin.responses?.weight || weightUnit !== previousWeightUnit;
  const syncWeight = profile.programme_type !== "boardroom" && Boolean(responses.weight) && (weightChanged || currentWeekCheckin?.responses?.weight_sync_pending === true);
  // Server-owned retry marker: a saved check-in must not conceal a failed chart write.
  delete responses.weight_sync_pending;
  if (syncWeight) responses.weight_sync_pending = true;
  const measurementFields: Record<string, string> = { waist: "waist_cm", chest: "chest_cm", hips: "hips_cm", left_arm: "left_arm_cm", right_arm: "right_arm_cm", left_thigh: "left_thigh_cm", right_thigh: "right_thigh_cm" };
  const pendingMetrics = currentWeekCheckin?.responses?.measurement_sync_pending;
  const syncMetrics = profile.programme_type === "boardroom" ? [] : Object.keys(measurementFields).filter(key => responses[key] && Number.isFinite(Number(responses[key])) && (!currentWeekCheckin || responses[key] !== currentWeekCheckin.responses?.[key] || (Array.isArray(pendingMetrics) && pendingMetrics.includes(key))));
  delete responses.measurement_sync_pending;
  if (syncMetrics.length) responses.measurement_sync_pending = syncMetrics;

  // Get next week number
  const { data: lastCheckin } = await admin
    .from("checkins")
    .select("week_number")
    .eq("client_id", profile.id)
    .order("week_number", { ascending: false })
    .limit(1)
    .single();

  const weekNumber = currentWeekCheckin?.week_number || ((lastCheckin?.week_number || 0) + 1);

  const payload = {
    client_id: profile.id,
    scheduled_date: currentWeekCheckin ? currentWeekCheckin.scheduled_date : selectedDate,
    checkin_form_id: submittedTemplateId,
    form_config_snapshot: submittedConfig,
    week_number: weekNumber,
    mood,
    // Populate legacy columns for backward compatibility
    wins: responses?.wins || null,
    challenges: responses?.challenges || null,
    questions: responses?.questions || null,
    // Store full responses in JSONB
    responses: responses || null,
  };

  const operation = currentWeekCheckin
    ? admin.from("checkins").update(payload).eq("id", currentWeekCheckin.id).eq("client_id", profile.id)
    : admin.from("checkins").insert(payload);

  const { data:savedCheckin, error: insertError } = await operation.select("id,created_at,scheduled_date").single();

  if (insertError) {
    const duplicateWeek =
      insertError.code === "23505" ||
      insertError.message?.includes("checkins_client_week_unique");

    if (duplicateWeek) return NextResponse.json({ error: "A check-in was saved in another tab. Keep your answers, reload the saved check-in and try again." }, { status: 409 });

    return NextResponse.json({ error: insertError.message }, { status: insertError.code === "P0001" ? 409 : 500 });
  }

  // Remember choices made on the current scheduled form, never historical corrections.
  const savedDate = currentWeekCheckin?.scheduled_date || (currentWeekCheckin ? checkinToday(new Date(currentWeekCheckin.created_at)) : selectedDate);
  const rememberUnit = profile.programme_type !== "boardroom" && body.weight_unit !== undefined
    && selectedDate === dates[0] && savedDate === dates[0] && weightUnit !== profile.weight_unit;
  const profileUpdate = {
    ...(!currentWeekCheckin ? { last_checkin: new Date().toISOString() } : {}),
    ...(rememberUnit ? { weight_unit: weightUnit } : {}),
  };
  let preferenceWarning: string | null = null;
  if (Object.keys(profileUpdate).length) {
    const { error: profileError } = await admin.from("client_profiles").update(profileUpdate).eq("id", profile.id);
    if (profileError && rememberUnit) preferenceWarning = "Check-in saved, but your preferred weight unit could not be remembered. Set it in Settings before your next check-in.";
  }

  let measurementWarning: string | null = null;
  // Auto-sync progress metrics to body measurements table
  if (responses && profile.programme_type !== "boardroom") {
    const measurement: Record<string, unknown> = {
      client_id: profile.id,
      // Legacy corrections retain the UTC key used when their chart row was created.
      measured_date: currentWeekCheckin && !currentWeekCheckin.scheduled_date ? currentWeekCheckin.created_at.slice(0,10) : currentWeekCheckin?.scheduled_date || selectedDate,
    };
    let hasData = false;
    // Unchanged ambiguous legacy weights stay untouched; explicit failed writes can retry.
    // Map check-in metric IDs to body measurement columns
    if (syncWeight && responses.weight && !isNaN(Number(responses.weight))) { measurement.weight_kg = weightToKg(Number(responses.weight), weightUnit); hasData = true; }
    for (const key of syncMetrics) { measurement[measurementFields[key]] = Number(responses[key]); hasData = true; }
    if (hasData) {
      const { error } = await admin.from("client_body_measurements").upsert(measurement, { onConflict: "client_id,measured_date", ignoreDuplicates: false });
      if (error) measurementWarning = "Check-in saved, but progress could not sync. Please reopen and save this check-in again, or log your weight on the Progress page.";
      else if (syncWeight || syncMetrics.length) {
        const syncedResponses = JSON.stringify(responses);
        delete responses.weight_sync_pending;
        delete responses.measurement_sync_pending;
        // Compare-and-set: clearing our retry marker must never replace a newer tab's answers.
        const { error: clearError } = await admin.from("checkins").update({ responses }).eq("client_id", profile.id).eq("week_number", weekNumber).eq("responses", syncedResponses);
        if (clearError) measurementWarning = "Check-in and weight saved. Please reopen and save again to confirm progress synchronization.";
      }
    }
  }

  return NextResponse.json({
    success: true,
    checkin_id:savedCheckin?.id||currentWeekCheckin?.id||null,
    // Scheduled photo folders stay distinct; preserve original legacy correction keys.
    photo_date: currentWeekCheckin ? currentWeekCheckin.scheduled_date || currentWeekCheckin.created_at.slice(0,10) : selectedDate,
    created_at:savedCheckin?.created_at||currentWeekCheckin?.created_at||null,
    week_number: weekNumber,
    measurementWarning,
    preferenceWarning,
    updated: Boolean(currentWeekCheckin),
  });
}
