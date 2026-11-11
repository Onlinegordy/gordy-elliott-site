import { revokeExternalProviderAccess } from "@/lib/account-provider-revocation";
import { loadConsultationConfig } from "@/lib/consultation-config";
import { consultationBodyContext } from "@/lib/consultation-metrics";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/admin-auth";
import { dbError } from "@/lib/api-errors";
import { getClientById } from "@/lib/admin-data";
import { isProgrammeType, legacyProfileForProgramme, isBoardroom } from "@/lib/programmes";
import { NextResponse } from "next/server";
import { notifyClientUser } from "@/lib/client-notifications";

const VALID_SEX_VALUES = ["female", "male", "prefer_not_to_say"];

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin();
  if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id } = await params;
  const client = await getClientById(id);

  if (!client) {
    return NextResponse.json({ error: "Client not found" }, { status: 404 });
  }

  const config = await loadConsultationConfig(createAdminClient(), client.programme_type);
  return NextResponse.json({ client: {...client, consultation_body_context: client.programme_type === 'boardroom' ? '' : consultationBodyContext(client.consultation_data, config.questions)} });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin();
  if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id } = await params;
  const body = await request.json();
  const admin = createAdminClient();
  const { data: currentProfile, error: currentProfileError } = await admin
    .from("client_profiles")
    .select("user_id, onboarding_status, activated_at, sex, programme_type, checkin_form_id")
    .eq("id", id)
    .maybeSingle();
  if (currentProfileError) return dbError(currentProfileError, "Couldn't load that client. Try again.");
  if (!currentProfile) return NextResponse.json({ error: "Client not found" }, { status: 404 });

  // Only allow safe profile fields to be patched
  const allowed = ["fitness_plans_enabled", "checkin_day", "checkin_form_id", "coach_notes", "start_weight", "programme_type", "onboarding_status", "date_of_birth", "sex", "cycle_tracking_enabled", "goals"];
  const updates: Record<string, unknown> = {};
  for (const key of allowed) {
    if (key in body) updates[key] = body[key];
  }

  if ("goals" in updates && updates.goals !== null && (typeof updates.goals !== "string" || updates.goals.length > 10000)) {
    return NextResponse.json({ error: "Goals must be text up to 10,000 characters" }, { status: 400 });
  }

  if ("programme_type" in updates) {
    if (!isProgrammeType(updates.programme_type)) {
      return NextResponse.json({ error: "Invalid programme" }, { status: 400 });
    }
    Object.assign(updates, legacyProfileForProgramme(updates.programme_type));
  }

  if ("fitness_plans_enabled" in updates && typeof updates.fitness_plans_enabled !== "boolean") return NextResponse.json({ error: "Choose on or off for fitness plans" }, { status: 400 });
  // Reset the optional entitlement whenever a client enters or leaves Boardroom.
  if ("programme_type" in updates && updates.programme_type !== currentProfile.programme_type && !("fitness_plans_enabled" in updates)) updates.fitness_plans_enabled = false;
  const nextProgramme = updates.programme_type || currentProfile.programme_type;
  if ("programme_type" in updates && isBoardroom(updates.programme_type) !== isBoardroom(currentProfile.programme_type) && !("checkin_form_id" in updates)) updates.checkin_form_id = null;
  if (updates.checkin_form_id) {
    const { data: template, error: templateError } = await admin.from("checkin_forms").select("config").eq("id", updates.checkin_form_id).maybeSingle();
    if (templateError) return dbError(templateError, "Couldn't load that check-in form.");
    if (!template || isBoardroom(template.config?.programme_type) !== isBoardroom(nextProgramme)) return NextResponse.json({ error: "Choose a check-in form for this client's programme" }, { status: 400 });
  }
  if (isBoardroom(nextProgramme) && ["sex", "date_of_birth", "cycle_tracking_enabled", "start_weight"].some((key) => key in body)) return NextResponse.json({ error: "Body measurements do not apply to Boardroom clients" }, { status: 400 });
  if ("onboarding_status" in updates) {
    if (!['invited', 'consultation_complete', 'active', 'paused'].includes(String(updates.onboarding_status))) {
      return NextResponse.json({ error: "Invalid onboarding status" }, { status: 400 });
    }
    const requestedStatus = String(updates.onboarding_status);
    const currentStatus = currentProfile.onboarding_status || "active";
    if (requestedStatus === "active" && !["consultation_complete", "paused", "active"].includes(currentStatus)) {
      return NextResponse.json({ error: "The consultation must be completed before this client can go live" }, { status: 409 });
    }
    if (requestedStatus === "consultation_complete" && !["invited", "consultation_complete"].includes(currentStatus)) {
      return NextResponse.json({ error: "That onboarding step has already been completed" }, { status: 409 });
    }
    if (requestedStatus === "invited" && currentStatus !== "invited") {
      return NextResponse.json({ error: "Onboarding cannot be moved back to invited" }, { status: 409 });
    }
    if (requestedStatus === "active" && currentStatus !== "active") {
      updates.activated_at = currentProfile.activated_at || new Date().toISOString();
      updates.activated_by = auth.userId;
    }
  }

  if ("sex" in updates) {
    if (updates.sex === "") updates.sex = null;
    if (updates.sex !== null && !VALID_SEX_VALUES.includes(String(updates.sex))) {
      return NextResponse.json({ error: "Invalid sex value" }, { status: 400 });
    }
  }

  if ("cycle_tracking_enabled" in updates) {
    const sexForEligibility = updates.sex === undefined
      ? currentProfile.sex
      : updates.sex;

    updates.cycle_tracking_enabled = sexForEligibility === "female"
      ? Boolean(updates.cycle_tracking_enabled)
      : false;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  const becameActive = updates.onboarding_status === "active" && currentProfile.onboarding_status !== "active";
  const { data: updatedProfile, error } = await admin
    .from("client_profiles")
    .update(updates)
    .eq("id", id)
    .select("user_id, onboarding_status, activated_at, goals")
    .maybeSingle();

  if (error) {
    return dbError(error, "Couldn't update that client. Try again.");
  }

  if (becameActive && updatedProfile?.user_id) {
      await notifyClientUser(updatedProfile.user_id, {
        title: isBoardroom(nextProgramme) ? "Your CAPACITY BOARDROOM plan is live" : "Your AT CAPACITY plan is live",
        message: "Gordy has finished your setup. Open the app to get started.",
        link: "/portal",
        tag: `onboarding-live-${id}`,
      });
  }

  return NextResponse.json({ success: true, client: updatedProfile });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin();
  if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id } = await params;
  const { user_id } = await request.json();

  if (!user_id) {
    return NextResponse.json({ error: "user_id is required" }, { status: 400 });
  }

  // Verify the user_id matches the client profile being deleted
  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("client_profiles")
    .select("user_id")
    .eq("id", id)
    .maybeSingle();

  if (!profile || profile.user_id !== user_id) {
    return NextResponse.json({ error: "user_id does not match this client" }, { status: 400 });
  }

  try {
    const [wearables, calendars] = await Promise.all([
      admin.from("client_wearable_connections").select("terra_user_id, raw_user").eq("client_id", id),
      admin.from("client_calendar_connections").select("composio_user_id, composio_connected_account_id").eq("client_id", id),
    ]);
    if (wearables.error || calendars.error) throw new Error("Provider lookup failed");
    await revokeExternalProviderAccess(wearables.data || [], calendars.data || []);
  } catch {
    console.error("Client deletion provider revocation failed", { clientId: id });
  }
  const { error } = await admin.auth.admin.deleteUser(user_id);

  if (error) {
    return dbError(error, "Couldn't revoke access. Try again.", 400);
  }

  return NextResponse.json({ success: true });
}
