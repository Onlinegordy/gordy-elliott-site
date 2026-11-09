import { requireAdmin } from "@/lib/admin-auth";
import {
  extractJsonObject,
  isCoachingNoteSourceType,
  labelCoachingNoteSource,
  normalizeCoachingNoteExtraction,
} from "@/lib/coaching-notes";
import { rateLimit } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { trackAIUsage } from "@/lib/ai-usage";
import { NextResponse } from "next/server";
import { assertAiSourceAllowed } from "@/lib/ai-source-policy.mjs";

const MODEL = "claude-sonnet-4-20250514";

function cleanDate(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

export async function POST(request: Request) {
  const auth = await requireAdmin();
  if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = await request.json();
  const clientId = typeof body.client_id === "string" ? body.client_id : "";
  const rawNotes = typeof body.raw_notes === "string" ? body.raw_notes.trim() : "";
  const sourceType = isCoachingNoteSourceType(body.source_type) ? body.source_type : "other";
  const sourceTitle = typeof body.source_title === "string" ? body.source_title.trim().slice(0, 180) : "";
  const sourceDate = cleanDate(body.source_date);
  try { assertAiSourceAllowed(body); } catch { return NextResponse.json({ error: "Imported Garmin data cannot be processed by AI." }, { status: 400 }); }

  if (!clientId) return NextResponse.json({ error: "client_id required" }, { status: 400 });
  if (rawNotes.length < 50) return NextResponse.json({ error: "Paste at least 50 characters of notes or transcript." }, { status: 400 });
  if (rawNotes.length > 30000) return NextResponse.json({ error: "Notes are too long. Keep this first version under 30,000 characters." }, { status: 400 });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "AI not configured" }, { status: 500 });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const rl = rateLimit(`admin-note-extract:${user?.id || "unknown"}`, 20, 15 * 60 * 1000);
  if (!rl.success) {
    return NextResponse.json(
      { error: "Too many extraction requests. Please wait before trying again." },
      { status: 429, headers: { "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } }
    );
  }

  const admin = createAdminClient();
  const { data: client, error: clientError } = await admin
    .from("client_profiles")
    .select("id, goals, primary_goal, goal_notes, tier, user:users!client_profiles_user_id_fkey(full_name, email)")
    .eq("id", clientId)
    .single();

  if (clientError || !client) return NextResponse.json({ error: "Client not found" }, { status: 404 });

  const userRecord = Array.isArray(client.user) ? client.user[0] : client.user;
  const clientName = (userRecord as Record<string, string> | null)?.full_name || "Client";
  const system = `You are Gordy Elliott's private coaching-note assistant.

Your job is to turn pasted call notes, Zoom transcripts, Loom comments, Fathom notes, WhatsApp notes, or manual coach notes into structured coaching context.

Rules:
- Output JSON only.
- Do not diagnose, prescribe medical advice, or invent facts not in the notes.
- Separate coach-only notes from any client-friendly recap.
- The client_summary must be safe to send to the client, but it will not be sent automatically.
- Keep task suggestions practical and coach-editable.
- Flag possible risks only when the notes explicitly mention them.
- Use Gordy's direct, practical coaching tone without over-polishing the client's words.

Return exactly this shape:
{
  "coach_summary": "Private 3-6 sentence summary for Gordy",
  "client_summary": "Short client-friendly recap draft",
  "coach_notes": "Private observations, context, constraints, or tone notes Gordy should remember",
  "priorities": [
    { "title": "Priority", "detail": "Why it matters or what to watch", "urgency": "low|medium|high" }
  ],
  "task_suggestions": [
    { "task_text": "Action Gordy may want to add as a client task", "reason": "Why this came up" }
  ],
  "follow_up_questions": ["Question Gordy may want to ask next"],
  "risk_flags": ["Only clear safety/admin concerns from the notes"]
}`;

  const prompt = {
    client: {
      name: clientName,
      tier: client.tier,
      primary_goal: client.primary_goal || client.goals || null,
      goal_notes: client.goal_notes || null,
    },
    source: {
      type: labelCoachingNoteSource(sourceType),
      title: sourceTitle || null,
      date: sourceDate,
    },
    notes: rawNotes,
  };

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 2500,
        system,
        messages: [{ role: "user", content: `Extract these coaching notes into the requested JSON:\n${JSON.stringify(prompt)}` }],
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error("Coaching note extraction failed:", err);
      return NextResponse.json({ error: "AI extraction failed" }, { status: 502 });
    }

    const data = await response.json();
    const text = data.content?.find((block: { type?: string }) => block.type === "text")?.text || data.content?.[0]?.text || "";
    const extraction = normalizeCoachingNoteExtraction(extractJsonObject(text));

    if (data.usage && user?.id) {
      await trackAIUsage({
        userId: user.id,
        model: MODEL,
        inputTokens: data.usage.input_tokens || 0,
        outputTokens: data.usage.output_tokens || 0,
        endpoint: "/api/admin/client-coaching-notes/extract",
      }).catch((error) => console.warn("Failed to track coaching-note AI usage", error));
    }

    return NextResponse.json({ extraction });
  } catch (error) {
    console.error("Coaching note extraction error:", error);
    return NextResponse.json({ error: "AI returned invalid coaching-note JSON" }, { status: 502 });
  }
}
