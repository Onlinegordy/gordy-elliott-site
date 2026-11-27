import { TrackedEmailError } from "@/lib/tracked-client-email";
import { requireAdmin } from "@/lib/admin-auth";
import { buildAccountRecoveryUrl } from "@/lib/account-links";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendWelcomeEmail } from "@/lib/email-templates";
import { isProgrammeType, legacyProfileForProgramme } from "@/lib/programmes";
import { NextResponse } from "next/server";

function generateTemporaryPassword(): string {
  const entropy = `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, "");
  return `Tmp!${entropy.slice(0, 24)}aA1`;
}

export async function POST(request: Request) {
  const auth = await requireAdmin();
  if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { name, email, password, programme_type } = await request.json();
  const normalizedName = name?.trim();
  const normalizedEmail = email?.trim()?.toLowerCase();
  const providedPassword = typeof password === "string" ? password.trim() : "";
  const mustSetPasswordOnFirstLogin = !providedPassword;

  if (!normalizedName || !normalizedEmail) {
    return NextResponse.json({ error: "Name and email are required" }, { status: 400 });
  }

  if (providedPassword && providedPassword.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
  }

  if (!isProgrammeType(programme_type)) {
    return NextResponse.json({ error: "Choose CAPACITY, SHIFT, FOUNDATIONS, IN PERSON or CAPACITY BOARDROOM" }, { status: 400 });
  }

  const legacyProgramme = legacyProfileForProgramme(programme_type);

  const admin = createAdminClient();

  // Check if user already exists
  const { data: existing } = await admin
    .from("users")
    .select("id")
    .eq("email", normalizedEmail)
    .limit(1);

  if (existing && existing.length > 0) {
    return NextResponse.json({ error: "A client with this email already exists" }, { status: 409 });
  }

  // Create user in Supabase Auth (triggers handle_new_user + handle_new_client)
  const { data: newUser, error: authError } = await admin.auth.admin.createUser({
    email: normalizedEmail,
    email_confirm: true,
    password: providedPassword || generateTemporaryPassword(),
    user_metadata: {
      full_name: normalizedName,
      role: "client",
      app_name: "gordy-elliott-portal",
      requires_password_setup: mustSetPasswordOnFirstLogin,
    },
  });

  if (authError) {
    return NextResponse.json({ error: authError.message }, { status: 500 });
  }

  // Wait for DB triggers to create profile
  await new Promise((r) => setTimeout(r, 1000));

  // Get the client profile
  const { data: profile } = await admin
    .from("client_profiles")
    .select("id")
    .eq("user_id", newUser.user.id)
    .single();

  if (!profile) {
    await admin.auth.admin.deleteUser(newUser.user.id);
    return NextResponse.json({ error: "Client profile was not created" }, { status: 500 });
  }

  const profileUpdates: Record<string, string> = {
    experience_mode: legacyProgramme.experience_mode,
    programme_type,
    onboarding_status: "invited",
    tier: legacyProgramme.tier,
  };
  const { error: profileUpdateError } = await admin
    .from("client_profiles")
    .update(profileUpdates)
    .eq("id", profile.id);

  if (profileUpdateError) {
    await admin.auth.admin.deleteUser(newUser.user.id);
    return NextResponse.json({ error: "Client profile could not be configured" }, { status: 500 });
  }

  // Auto-assign published training modules
  const { data: modules } = await admin
    .from("training_modules")
    .select("id")
    .eq("is_published", true)
    .contains("programme_audiences", [programme_type]);

  if (modules && modules.length > 0) {
    await admin.from("client_modules").insert(
      modules.map((mod) => ({
        client_id: profile.id,
        module_id: mod.id,
        status: "locked" as const,
      }))
    );
  }

  // Create welcome notification
  await admin.from("notifications").insert({
    user_id: newUser.user.id,
    title: programme_type === "boardroom" ? "Welcome to CAPACITY BOARDROOM" : "Welcome to AT CAPACITY",
    message: `Welcome ${normalizedName.split(" ")[0]}! Set your password and complete the consultation${programme_type === "boardroom" ? " so Gordy can prepare your coaching plan." : ". Your plan gets built from your consultation."}`,
    link: "/portal/consultation",
  });

  // Generate password setup link
  const { data: linkData } = await admin.auth.admin.generateLink({
    type: "recovery",
    email: normalizedEmail,
  });

  const setupUrl = linkData?.properties?.hashed_token
    ? buildAccountRecoveryUrl(linkData.properties.hashed_token, "setup")
    : linkData?.properties?.action_link || null;

  // Send welcome email via unified template
  let emailSent = false;
  let emailFailureStatus: "failed" | "unknown" = "failed";
  try {
    if (setupUrl) {
      await sendWelcomeEmail(normalizedEmail, normalizedName, setupUrl, profile.id, programme_type);
      emailSent = true;
    }
  } catch (e) {
    if (e instanceof TrackedEmailError) emailFailureStatus = e.sendStatus;
    console.log("[INVITE] Email acceptance failed:", e instanceof Error ? e.message : e);
  }

  return NextResponse.json({
    success: true,
    userId: newUser.user.id,
    profileId: profile.id,
    emailSent,
    emailStatus: emailSent ? "accepted" : emailFailureStatus,
    emailDeliveryVerified: false,
    passwordSet: !mustSetPasswordOnFirstLogin,
    setupUrl: emailSent ? null : setupUrl, // Return URL if email didn't send, so Gordy can share manually
  });
}
