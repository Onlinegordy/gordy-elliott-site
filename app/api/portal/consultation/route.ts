import { consultationMetricError, consultationBodyContext } from "@/lib/consultation-metrics";
import { HOME_EQUIPMENT_FIELD, HOME_EQUIPMENT_MAX_LENGTH, homeTrainingSelected, savedHomeEquipmentDetails } from "@/lib/home-equipment";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { dbError } from "@/lib/api-errors";
import { loadConsultationConfig } from "@/lib/consultation-config";
import type { FormQuestion } from "@/lib/types";
import { isBoardroomConsultation, validateConsultationAnswers, buildBoardroomConsultationSummary } from "@/lib/boardroom-consultation";
import { getSiteUrl } from "@/lib/site-url";
import { NextRequest, NextResponse } from "next/server";
import { isValidIsoDateOfBirth } from "@/lib/date-of-birth";
import { hasExcludedMachineProvenance } from "@/lib/ai-source-policy.mjs";

const VALID_SEX_VALUES = ["female", "male", "prefer_not_to_say"];
const PROFILE_FIELD_IDS = new Set(["date_of_birth", "sex", "cycle_tracking_enabled"]);

function answerText(data: Record<string, unknown>, key: string) {
  const value = data[key];
  return typeof value === "string" ? value.trim() : "";
}

function buildFallbackSummary(data: Record<string, unknown>, questions: FormQuestion[]) {
  return {
    generated_by: "deterministic",
    generated_at: new Date().toISOString(),
    hierarchy: {
      you: answerText(data, "hierarchy_you"),
      past_experiences: answerText(data, "hierarchy_past"),
      now: answerText(data, "hierarchy_now"),
      support_networks: answerText(data, "hierarchy_support"),
      exercise_nutrition: answerText(data, "hierarchy_exercise_nutrition"),
    },
    coaching_profile: {
      primary_goal: answerText(data, "primary_goal"),
      fitness_level: answerText(data, "fitness_level"),
      training_days: answerText(data, "training_days"),
      equipment_access: answerText(data, "equipment_access"),
      body_metrics: consultationBodyContext(data, questions),
      home_equipment_details: homeTrainingSelected(data) ? answerText(data, HOME_EQUIPMENT_FIELD) : "",
      dietary_preferences: answerText(data, "dietary_preferences"),
      injuries: answerText(data, "injuries"),
    },
    flags: {
      mentions_support_risk: /drag|negative|sabotage|pressure|stress|alone|isolat/i.test(answerText(data, "hierarchy_support")),
      mentions_injury_or_limitation: Boolean(answerText(data, "injuries")),
      prefers_lifestyle_nutrition: /lifestyle|flexible|balance|habit/i.test(answerText(data, "hierarchy_exercise_nutrition")),
      prefers_strict_nutrition: /strict|plan|rules|structure/i.test(answerText(data, "hierarchy_exercise_nutrition")),
    },
  };
}

async function extractConsultationSummary(data: Record<string, unknown>, questions: FormQuestion[]) {
  const fallback = buildFallbackSummary(data, questions);
  if (hasExcludedMachineProvenance(data)) return fallback;
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return fallback;

  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": getSiteUrl(),
        "X-Title": "Gordy Elliott Portal",
      },
      body: JSON.stringify({
        model: process.env.OPENROUTER_CONSULTATION_MODEL || "openai/gpt-4o-mini",
        provider: { zdr: true },
        messages: [
          {
            role: "system",
            content: "Extract a structured coaching profile from a client consultation. Return compact JSON only. Do not diagnose, label trauma, or make medical claims.",
          },
          {
            role: "user",
            content: JSON.stringify({
              required_shape: {
                generated_by: "openrouter",
                hierarchy: {
                  you: "summary of identity/values",
                  past_experiences: "summary of setbacks",
                  now: "summary of current reality",
                  support_networks: "support and drag factors",
                  exercise_nutrition: "preferences and approach",
                },
                coaching_profile: {
                  primary_goal: "goal",
                  fitness_level: "level",
                  training_days: "days",
                  equipment_access: "equipment",
                  home_equipment_details: "exact home equipment, weights and quantities; retain the supplied inventory",
                  dietary_preferences: "diet context",
                  injuries: "limitations",
                },
                flags: {
                  mentions_support_risk: true,
                  mentions_injury_or_limitation: true,
                  prefers_lifestyle_nutrition: true,
                  prefers_strict_nutrition: false,
                },
                coach_notes: ["short practical coaching notes"],
              },
              consultation_answers: data,
            }),
          },
        ],
        response_format: { type: "json_object" },
      }),
    });

    if (!response.ok) return fallback;
    const payload = await response.json();
    const content = payload?.choices?.[0]?.message?.content;
    if (!content || typeof content !== "string") return fallback;
    const parsed = JSON.parse(content);
    return {
      ...fallback,
      ...parsed,
      coaching_profile: {...fallback.coaching_profile, ...parsed.coaching_profile, home_equipment_details: fallback.coaching_profile.home_equipment_details, body_metrics:fallback.coaching_profile.body_metrics},
      generated_by: "openrouter",
      generated_at: new Date().toISOString(),
    };
  } catch {
    return fallback;
  }
}

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: profile, error: profileError } = await admin
    .from("client_profiles")
    .select("programme_type, consultation_data, consultation_summary, profile_setup_data, profile_setup_completed_at, wearables_preference, wearables_notes, phone, date_of_birth, sex, cycle_tracking_enabled")
    .eq("user_id", user.id)
    .maybeSingle();

  if (profileError) return dbError(profileError, "Couldn’t load your consultation. Try again.");
  if (!profile) return NextResponse.json({ error: "Client profile not found" }, { status: 404 });
  const config = await loadConsultationConfig(admin, profile.programme_type);

  return NextResponse.json({
    programmeType: profile.programme_type,
    consultation_data: profile?.consultation_data || null,
    consultation_summary: profile?.consultation_summary || null,
    profile_setup_data: profile?.profile_setup_data || null,
    profile_setup_completed_at: profile?.profile_setup_completed_at || null,
    wearables_preference: profile?.wearables_preference || "",
    wearables_notes: profile?.wearables_notes || "",
    phone: profile?.phone || "",
    date_of_birth: profile?.date_of_birth || "",
    sex: profile?.sex || "",
    cycle_tracking_enabled: Boolean(profile?.cycle_tracking_enabled),
    config,
  });
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await req.json();
  if (body.privacy_consent !== true) {
    return NextResponse.json({ error: "Privacy consent is required" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: currentProfile, error: currentProfileError } = await admin
    .from("client_profiles")
    .select("id, onboarding_status, programme_type, consultation_data")
    .eq("user_id", user.id)
    .maybeSingle();
  if (currentProfileError) return dbError(currentProfileError, "Couldn't load your consultation. Try again.");
  if (!currentProfile) return NextResponse.json({ error: "Client profile not found" }, { status: 404 });
  const shouldAdvanceOnboarding = currentProfile.onboarding_status === "invited";
  const boardroom = isBoardroomConsultation(currentProfile.programme_type);
  const config = await loadConsultationConfig(admin, currentProfile.programme_type);
  const validationError = validateConsultationAnswers(config, body) || (!boardroom && consultationMetricError(Object.fromEntries(config.questions.filter(q=>q.enabled!==false).map(q=>[q.id,body[q.id]]))));
  if (validationError) return NextResponse.json({ error: validationError }, { status: 400 });
  const enabledQuestions = config.questions.filter((question) => question.enabled !== false);
  const enabledIds = new Set(enabledQuestions.map((question) => question.id));
  if (!boardroom && HOME_EQUIPMENT_FIELD in body && (typeof body[HOME_EQUIPMENT_FIELD] !== "string" || body[HOME_EQUIPMENT_FIELD].length > HOME_EQUIPMENT_MAX_LENGTH)) {
    return NextResponse.json({error:"Home equipment details must be text of up to 4,000 characters"},{status:400});
  }
  const consultationData: Record<string, unknown> = {};
  for (const question of enabledQuestions) {
    if (!PROFILE_FIELD_IDS.has(question.id) && question.id in body) {
      consultationData[question.id] = body[question.id];
    }
  }
  if (!boardroom) {
    for(const key of ["height_cm","weight_kg"]) if((!(key in body)||!enabledIds.has(key))&&currentProfile.consultation_data?.[key]!==undefined)consultationData[key]=currentProfile.consultation_data[key];
    const details = savedHomeEquipmentDetails(body, currentProfile.consultation_data);
    if (details !== undefined) consultationData[HOME_EQUIPMENT_FIELD] = details;
  }
  consultationData.privacy_consent = true;
  consultationData.privacy_consent_version = boardroom ? "business_coaching_v1" : "health_cycle_v1";
  consultationData.privacy_consent_at = new Date().toISOString();

  const updates: Record<string, unknown> = {
    consultation_data: consultationData,
  };

  if (!boardroom && body.profile_setup && typeof body.profile_setup === "object") {
    const setup = body.profile_setup as Record<string, unknown>;
    updates.profile_setup_data = setup;
    updates.profile_setup_completed_at = new Date().toISOString();
    updates.phone = typeof setup.phone === "string" ? setup.phone.trim() || null : null;
    updates.wearables_preference = typeof setup.wearables_preference === "string" ? setup.wearables_preference : null;
    updates.wearables_notes = typeof setup.wearables_notes === "string" ? setup.wearables_notes.trim() || null : null;
  }

  if (!boardroom && enabledIds.has("date_of_birth")) {
    const dateOfBirth = typeof body.date_of_birth === "string" ? body.date_of_birth.trim() : "";
    if (dateOfBirth && !isValidIsoDateOfBirth(dateOfBirth)) {
      return NextResponse.json({ error: "Enter a valid date of birth in DD/MM/YYYY format" }, { status: 400 });
    }
    updates.date_of_birth = dateOfBirth || null;
  }

  if (!boardroom && enabledIds.has("sex")) {
    const nextSex = body.sex === "" || body.sex === undefined ? null : body.sex;
    if (nextSex !== null && !VALID_SEX_VALUES.includes(nextSex)) {
      return NextResponse.json({ error: "Invalid sex value" }, { status: 400 });
    }

    updates.sex = nextSex;
    updates.cycle_tracking_enabled =
      nextSex === "female" && enabledIds.has("cycle_tracking_enabled")
        ? Boolean(body.cycle_tracking_enabled)
        : false;
  }

  if (boardroom) {
    const mobile = answerText(consultationData, "business_mobile");
    if (mobile) updates.phone = mobile;
  }
  updates.consultation_summary = boardroom ? buildBoardroomConsultationSummary(consultationData) : await extractConsultationSummary(consultationData, config.questions);
  if (shouldAdvanceOnboarding) updates.onboarding_status = "consultation_complete";

  const { error } = await admin
    .from("client_profiles")
    .update(updates)
    .eq("user_id", user.id);

  if (error) {
    return dbError(error, "Couldn't save your consultation. Try again.");
  }

  const { data: admins } = await admin.from("users").select("id").eq("role", "admin");
  if (shouldAdvanceOnboarding && admins?.length) {
    await admin.from("notifications").insert(admins.map((adminUser) => ({
      user_id: adminUser.id,
      title: "Consultation ready for setup",
      message: "A client has completed their consultation. Review their answers and activate access when their plan is ready.",
      link: `/admin/clients/${currentProfile.id}`,
      tag: `consultation-ready-${currentProfile.id}`,
    })));
  }

  return NextResponse.json({ success: true });
}
