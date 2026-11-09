"use client";
import { checkinDatedSummary } from "@/lib/checkin-schedule";

import { useState, useEffect } from "react";
import { checkinConfigForWeightUnit, convertWeightInput, type WeightUnit } from "@/lib/weight-units";
import Link from "next/link";
import { useToast } from "@/components/ui/Toast";
import CyclingStatusText from "@/components/ui/CyclingStatusText";
import type { CheckinFormConfig, ClientTask, ProgressMetric } from "@/lib/types";
import { normalizeCheckinConfig } from "@/lib/checkin-form";
import { checkinDate } from "@/lib/checkin-message";
import { canReadCoachCheckinReplies, coachCheckinReplyHref, type CoachCheckinReply } from "@/lib/checkin-replies";
import type { WearableDailySummary } from "@/lib/wearable-insights";
import PhotoUpload from "@/components/portal/PhotoUpload";
import ScrollSafeRange from "@/components/ui/ScrollSafeRange";

const moodColorMap: Record<string, string> = {
  emerald: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
  blue: "border-blue-500/30 bg-blue-500/10 text-blue-400",
  amber: "border-amber-500/30 bg-amber-500/10 text-amber-400",
  red: "border-red-500/30 bg-red-500/10 text-red-400",
};

function getCheckinDueDate(checkinDay: string | null) {
  const dayMap: Record<string, number> = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
  const targetDay = dayMap[(checkinDay || "monday").toLowerCase()] ?? 1;
  const now = new Date();
  const weekStart = new Date(now);
  const diff = now.getDay() === 0 ? -6 : 1 - now.getDay();
  weekStart.setDate(now.getDate() + diff);
  weekStart.setHours(0, 0, 0, 0);
  const due = new Date(weekStart);
  due.setDate(weekStart.getDate() + (targetDay === 0 ? 6 : targetDay - 1));
  return due;
}

function isToday(date: Date) {
  const now = new Date();
  return date.getDate() === now.getDate() && date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
}

function ScaleInput({ metric, value, onChange }: { metric: ProgressMetric; value: string; onChange: (v: string) => void }) {
  const min = metric.min ?? 1;
  const max = metric.max ?? 10;
  const selected = value ? parseInt(value) : null;
  const sliderValue = selected ?? min;
  const percent = max > min ? ((sliderValue - min) / (max - min)) * 100 : 0;
  const scaleLabel = selected === null ? "Slide to set" : selected <= 3 ? "Low" : selected <= 6 ? "Moderate" : "High";
  const valueLabel = selected === null ? "Not set" : `${selected} / ${max}`;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-semibold text-text-secondary">{scaleLabel}</div>
        <div className="rounded-full border border-[#E040D0]/20 bg-[#E040D0]/8 px-2.5 py-0.5 text-xs font-bold text-[#E040D0]">
          {valueLabel}
        </div>
      </div>
      <ScrollSafeRange
        min={min}
        max={max}
        step={1}
        value={sliderValue}
        onValueChange={onChange}
        aria-label={metric.label}
        aria-valuetext={selected === null ? "Not set" : `${selected} out of ${max}`}
        className="range-shift"
        style={{ "--range-pct": `${percent}%` } as React.CSSProperties}
      />
      <div className="flex justify-between text-[11px] font-semibold text-text-muted">
        <span>{min}</span>
        <span>{max}</span>
      </div>
    </div>
  );
}

function ChoiceButton({
  name,
  value,
  label,
  selected,
  onChange,
  selectedClass = "border-[#E040D0]/45 bg-[#E040D0]/12 text-[#B830A8] shadow-[0_12px_26px_rgba(224,64,208,0.10)]",
}: {
  name: string;
  value: string;
  label: string;
  selected: boolean;
  onChange: () => void;
  selectedClass?: string;
}) {
  return (
    <label
      className={`flex min-h-[58px] items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-left text-sm font-semibold transition-all has-[input:focus-visible]:ring-2 has-[input:focus-visible]:ring-[#E040D0]/45 has-[input:focus-visible]:ring-offset-2 active:scale-[0.99] ${
        selected
          ? selectedClass
          : "border-[rgba(0,0,0,0.08)] bg-bg-card text-text-secondary hover:border-[#E040D0]/30 hover:bg-[#E040D0]/5 hover:text-text-primary"
      }`}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={selected}
        onChange={onChange}
        className="sr-only"
      />
      <span>{label}</span>
      <span className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border ${
        selected ? "border-current bg-current" : "border-[rgba(0,0,0,0.16)]"
      }`}>
        {selected && (
          <svg className="h-3 w-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        )}
      </span>
    </label>
  );
}

function CoachReplies({ replies, unavailable, currentWeekId, currentWeekSubmitted }: {
  replies: CoachCheckinReply[];
  unavailable: boolean;
  currentWeekId: string | null;
  currentWeekSubmitted: boolean;
}) {
  const latest = replies[0];
  const hasCurrentReply = currentWeekId && replies.some((reply) => reply.id === currentWeekId);

  function replyContent(reply: CoachCheckinReply) {
    return (
      <>
        <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-text-primary">{reply.admin_reply}</p>
        <div className="mt-3 text-xs text-text-muted">
          Check-in submitted {checkinDate(reply.created_at)}
          {reply.replied_at && <> · Replied {checkinDate(reply.replied_at)}</>}
        </div>
        {reply.reply_message_id && (
          <Link href={coachCheckinReplyHref(reply)} className="mt-3 inline-flex min-h-11 items-center text-xs font-semibold text-accent-bright">
            Continue in DMs →
          </Link>
        )}
      </>
    );
  }

  return (
    <section id="coach-replies" aria-labelledby="coach-replies-heading" className="mb-6 scroll-mt-24 rounded-2xl border border-[#E040D0]/20 bg-[#E040D0]/5 px-4 py-4">
      <h2 id="coach-replies-heading" className="text-sm font-semibold text-[#E040D0]">Replies from Gordy</h2>
      {unavailable ? (
        <p className="mt-2 text-sm text-text-secondary">We couldn&apos;t load your coach replies. Please refresh to try again.</p>
      ) : (
        <>
          {currentWeekSubmitted && !hasCurrentReply && (
            <p className="mt-2 text-sm text-text-secondary">Your check-in is saved. Gordy&apos;s reply for this week will appear here when it&apos;s ready.</p>
          )}
          {!latest && !currentWeekSubmitted && (
            <p className="mt-2 text-sm text-text-secondary">No coach replies yet. Replies to your check-ins will appear here.</p>
          )}
          {latest && (
            <article id={`coach-reply-${latest.id}`} className="mt-3 scroll-mt-24">
              <h3 className="text-xs font-semibold text-text-secondary">{latest.id === currentWeekId ? "This week’s reply" : "Latest reply"}</h3>
              {replyContent(latest)}
            </article>
          )}
          {replies.length > 1 && (
            <div className="mt-4 space-y-3 border-t border-[#E040D0]/15 pt-4">
              <h3 className="text-xs font-semibold text-text-secondary">Earlier replies</h3>
              {replies.slice(1).map((reply) => (
                <details key={reply.id} id={`coach-reply-${reply.id}`} open={reply.id === currentWeekId} className="scroll-mt-24 rounded-xl border border-[rgba(0,0,0,0.08)] bg-bg-card px-3 py-2">
                  <summary className="min-h-11 cursor-pointer content-center text-sm font-semibold text-text-primary">Check-in from {checkinDate(reply.created_at)}</summary>
                  {replyContent(reply)}
                </details>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}

export default function CheckInPage() {
  const { toast } = useToast();
  const [configRevision, setConfigRevision] = useState<string | null>(null);
  const [config, setConfig] = useState<CheckinFormConfig | null>(null);
  const [mood, setMood] = useState<string | null>(null);
  const [responses, setResponses] = useState<Record<string, string>>({});
  const [weightUnit, setWeightUnit] = useState<WeightUnit>("kg");
  const [history, setHistory] = useState<Array<{id:string;created_at:string;week_number:number;scheduled_date?:string|null}>>([]);
  const [scheduledDates,setScheduledDates]=useState<string[]>([]);
  const [scheduledDate,setScheduledDate]=useState<string|null>(null);
  const [editingHistory, setEditingHistory] = useState(false);
  const [progressData, setProgressData] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState(false);
  const [photos, setPhotos] = useState<Record<string, File>>({});
  const [tier, setTier] = useState<string>("coached");
  const [tierLoaded, setTierLoaded] = useState(false);
  const [pending, setPending] = useState(false);
  const [businessCheckin, setBusinessCheckin] = useState(false);
  const [monthlyReview, setMonthlyReview] = useState<{periodStart:string;periodEnd:string;nextDue:string;latest:{response:string;period_start:string;message_id:string|null}|null}|null>(null);
  const [loadError, setLoadError] = useState("");
  const [currentWeekSubmitted, setCurrentWeekSubmitted] = useState(false);
  const [currentWeekSavedAt, setCurrentWeekSavedAt] = useState<string | null>(null);
  const [currentWeekId, setCurrentWeekId] = useState<string | null>(null);
  const [checkinDay, setCheckinDay] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState("");
  const [templateName, setTemplateName] = useState<string | null>(null);
  const [openCoachTasks, setOpenCoachTasks] = useState<ClientTask[]>([]);
  const [coachReplies, setCoachReplies] = useState<CoachCheckinReply[]>([]);
  const [repliesUnavailable, setRepliesUnavailable] = useState(true);
  const [priorityMessage, setPriorityMessage] = useState("");
  const [supportAsk, setSupportAsk] = useState("");
  const [syncedMetricIds, setSyncedMetricIds] = useState<string[]>([]);
  const [syncedSummaryDate, setSyncedSummaryDate] = useState<string | null>(null);
  const tierCopy = {
    coached: {
      line: "Let Gordy know how you're getting on this week.",
      lane: "Standard coaching lane",
      rhythm: "This is the weekly reflection Gordy reviews to guide your next steps.",
    },
    premium: {
      line: "Use this check-in to surface friction, progress, and where you need extra support this week.",
      lane: "Support lane",
      rhythm: "This check-in should make your progress and support needs obvious before the week gets away from you.",
    },
    vip: {
      line: "Use this check-in to flag the things Gordy should see first this week.",
      lane: "Priority lane",
      rhythm: "This is your highest-priority reflection point, designed to keep support tight and visible.",
    },
    ai_only: {
      line: "Use this to reflect on your week and keep your momentum moving.",
      lane: "AI coaching lane",
      rhythm: "This helps you stay honest with your progress even without live coaching support.",
    },
  } as const;

  function formatDay(day: string | null) {
    if (!day) return "your check-in day";
    return `${day.charAt(0).toUpperCase()}${day.slice(1)}`;
  }

  function formatSavedAt(dateStr: string | null) {
    if (!dateStr) return "";
    return new Date(dateStr).toLocaleDateString("en-GB", {
      weekday: "short",
      day: "numeric",
      month: "short",
    });
  }

  useEffect(() => {
    fetch("/api/portal/me")
      .then((r) => r.json())
      .then((d) => { setTier(d.tier || "coached"); setTierLoaded(true); })
      .catch(() => setTierLoaded(true));
  }, []);

  useEffect(() => {
    if (tier !== "premium" && tier !== "vip") return;
    fetch("/api/portal/tasks")
      .then((r) => (r.ok ? r.json() : { tasks: [] }))
      .then((d) => {
        const open = (d.tasks || []).filter((t: ClientTask) => !t.completed && t.source !== "client");
        setOpenCoachTasks(open);
      })
      .catch(() => setOpenCoachTasks([]));
  }, [tier]);

  useEffect(() => {
    let cancelled = false;
    async function loadConfig() {
      try {
        const stateRes = await fetch(`/api/portal/checkin${window.location.search}`);

        if (stateRes.ok) {
          const stateData = await stateRes.json();
          if (cancelled) return;
          const isBusiness = stateData.programmeType === "boardroom";
          setWeightUnit(stateData.weightUnit || "kg");
          setHistory(stateData.history || []);
          setScheduledDates(stateData.scheduledDates||[]);setScheduledDate(stateData.scheduledDate||null);
          setEditingHistory(Boolean(stateData.editingHistory));
          setBusinessCheckin(isBusiness);
          setMonthlyReview(stateData.monthlyReview || null);
          setPending(Boolean(stateData.pending));
          if (stateData.pending) { setLoadError(""); return; }
          const normalizedConfig = normalizeCheckinConfig(stateData.config, isBusiness ? "boardroom" : undefined);
          setConfig(normalizedConfig);
          setConfigRevision(stateData.configRevision || null);
          setCheckinDay(stateData.checkinDay || null);
          setTemplateName(stateData.templateName || null);
          setCoachReplies(stateData.checkinReplies || []);
          setRepliesUnavailable(Boolean(stateData.repliesUnavailable));
          setLoadError("");
          if (stateData.currentWeekCheckin) {
            const existing = stateData.currentWeekCheckin;
            setCurrentWeekId(existing.id);
            setMood(existing.mood || null);
            const existingResponses = { wins: existing.wins || "", challenges: existing.challenges || "", questions: existing.questions || "", ...(existing.responses || {}) };
            setResponses(existingResponses);
            // Keep metrics separate so stale saved question answers cannot overwrite edits.
            const metricIds = new Set((normalizedConfig.progress_tracking || []).map(metric => metric.id));
            setProgressData(Object.fromEntries(Object.entries(existingResponses).filter(([key]) => metricIds.has(key))) as Record<string, string>);
            if (typeof existingResponses.priority_message === "string") {
              setPriorityMessage(existingResponses.priority_message);
            }
            if (typeof existingResponses.support_ask === "string") {
              setSupportAsk(existingResponses.support_ask);
            }
            setCurrentWeekSubmitted(true);
            setCurrentWeekSavedAt(existing.created_at || null);
          } else if (!isBusiness) {
            const integrationsRes = await fetch("/api/portal/integrations");
            if (integrationsRes.ok && !cancelled) {
              const integrationsData = await integrationsRes.json();
              const summary = checkinDatedSummary((integrationsData.summaries || []) as WearableDailySummary[], stateData.scheduledDate);
              if (summary) {
                const synced: Record<string, string> = {};
                const enabledMetricIds = new Set(
                  (normalizedConfig.progress_tracking || []).filter((metric) => metric.enabled).map((metric) => metric.id),
                );
                if (enabledMetricIds.has("hrv") && summary.hrv_ms !== null) synced.hrv = String(Math.round(summary.hrv_ms));
                if (enabledMetricIds.has("steps") && summary.steps !== null) synced.steps = String(Math.round(summary.steps));
                if (enabledMetricIds.has("sleep_hours") && summary.sleep_minutes !== null) synced.sleep_hours = (summary.sleep_minutes / 60).toFixed(1);
                if (Object.keys(synced).length > 0) {
                  setProgressData((previous) => ({ ...synced, ...previous }));
                  setSyncedMetricIds(Object.keys(synced));
                  setSyncedSummaryDate(summary.summary_date);
                }
              }
            }
          }
        } else {
          if (cancelled) return;
          setLoadError("We couldn't load your assigned check-in. Please refresh and try again.");
        }
      } catch {
        if (cancelled) return;
        setLoadError("We couldn't load your assigned check-in. Please refresh and try again.");
      }
    }
    loadConfig();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!config || !tierLoaded) return;
    function revealReply() {
      const id = window.location.hash.slice(1);
      if (id !== "coach-replies" && !id.startsWith("coach-reply-")) return;
      const target = document.getElementById(id);
      if (target instanceof HTMLDetailsElement) target.open = true;
      target?.scrollIntoView({ block: "start" });
    }
    revealReply();
    window.addEventListener("hashchange", revealReply);
    return () => window.removeEventListener("hashchange", revealReply);
  }, [config, tierLoaded]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (config?.mood_enabled && !mood) return;
    setError(false);
    setSubmitting(true);

    // Merge progress data and tier-specific priority fields into responses JSONB
    const fullResponses: Record<string, string> = { ...responses, ...progressData };
    const isHighTouch = tier === "premium" || tier === "vip";
    if (isHighTouch) {
      if (priorityMessage.trim()) fullResponses.priority_message = priorityMessage.trim();
      else fullResponses.priority_message = "";
      if (supportAsk.trim()) fullResponses.support_ask = supportAsk.trim();
      else fullResponses.support_ask = "";
    }

    try {
      const res = await fetch("/api/portal/checkin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scheduled_date:scheduledDate, mood: mood || "good", responses: fullResponses, config_revision: configRevision, weight_unit: weightUnit, ...(currentWeekId ? { checkin_id: currentWeekId } : {}) }),
      });

      if (res.ok) {
        const data = await res.json();
        // Upload any progress photos — surface any partial failures so the client
        // isn't told "saved" when some photos didn't actually land.
        const failedPhotoAngles: string[] = [];
        if (Object.keys(photos).length > 0) {
          const photoDate = data.photo_date || (currentWeekSavedAt || new Date().toISOString()).split("T")[0];
          const photoResults = await Promise.all(
            Object.entries(photos).map(async ([angle, file]) => {
              try {
                const fd = new FormData();
                fd.append("file", file);
                fd.append("angle", angle);
                fd.append("date", photoDate);
                const photoRes = await fetch("/api/portal/upload-photo", { method: "POST", body: fd });
                return { angle, ok: photoRes.ok };
              } catch {
                return { angle, ok: false };
              }
            })
          );
          failedPhotoAngles.push(
            ...photoResults
              .filter((result) => !result.ok)
              .map((result) => `${result.angle.charAt(0).toUpperCase()}${result.angle.slice(1)}`)
          );
        }
        setCurrentWeekSubmitted(true);
        if(data.checkin_id)setCurrentWeekId(data.checkin_id);
        if(data.created_at)setCurrentWeekSavedAt(data.created_at);
        else if (!currentWeekSavedAt) setCurrentWeekSavedAt(new Date().toISOString());
        setSaveMessage(data.updated ? "Your saved check-in was updated." : `Your check-in for ${scheduledDate || "this week"} was saved.`);
        setSubmitted(true);
        const saveWarnings = [data.measurementWarning, data.preferenceWarning].filter(Boolean).join(" ");
        if (failedPhotoAngles.length > 0) {
          toast(
            `Check-in saved, but these photo${failedPhotoAngles.length === 1 ? "" : "s"} didn't upload: ${failedPhotoAngles.join(", ")}. Try re-adding from Progress. ${saveWarnings}`.trim(),
            "error"
          );
        } else {
          toast(saveWarnings || (data.updated ? "Saved check-in updated" : monthlyReview ? "Check-in saved for your monthly review" : "Check-in submitted - Gordy will review it this week"), saveWarnings ? "error" : "success");
        }
      } else {
        const data = await res.json().catch(() => ({}));
        setError(true);
        toast(data.error || "Something went wrong. Please try again.", "error");
        setTimeout(() => setError(false), 5000);
      }
    } catch {
      setError(true);
      toast("Something went wrong. Please try again.", "error");
      setTimeout(() => setError(false), 5000);
    }

    setSubmitting(false);
  }

  function resetForm() {
    setSubmitted(false);
    setSaveMessage("");
  }

  if (tierLoaded && tier === "ai_only") {
    return (
      <div className="mx-auto w-full max-w-2xl">
        <div className="bg-bg-card border border-[rgba(0,0,0,0.06)] rounded-2xl p-8 text-center">
          <div className="w-16 h-16 bg-[#E040D0]/10 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-[#E040D0]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>
          <h2 className="text-lg font-heading font-bold text-text-primary mb-2">Not Available on Your Plan</h2>
          <p className="text-sm text-text-secondary mb-6">Weekly coach check-ins are not enabled in your current setup. Your AI coach is available to help you track progress instead.</p>
          <a href="/portal" className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white rounded-xl" style={{ background: "linear-gradient(135deg, #E040D0 0%, #b830a8 100%)" }}>
            Back to Dashboard
          </a>
        </div>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="mx-auto flex min-h-[calc(100dvh-11rem)] w-full max-w-2xl items-center">
        <div className="w-full bg-bg-card border border-emerald-500/20 rounded-3xl p-8 text-center shadow-lg">
          <div className="w-16 h-16 bg-emerald-500/10 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-2xl font-heading font-bold text-text-primary mb-2">Check-in Saved</h2>
          <p className="text-text-secondary">{saveMessage || "Gordy will review your check-in and respond shortly."}</p>
          {currentWeekSavedAt && (
            <p className="mt-2 text-sm text-text-muted">Saved {formatSavedAt(currentWeekSavedAt)}</p>
          )}
          <div className="mt-6 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
            <button
              onClick={resetForm}
              className="px-6 py-3 gradient-accent text-white rounded-xl text-sm font-semibold cursor-pointer"
            >
              Edit saved check-in
            </button>
            {!businessCheckin && <Link
              href="/portal/progress"
              className="px-6 py-3 rounded-xl border border-[rgba(0,0,0,0.08)] bg-bg-primary text-sm font-semibold text-text-primary no-underline"
            >
              Log your progress
            </Link>}
            <Link
              href="/portal"
              className="text-xs font-semibold text-text-muted no-underline hover:text-text-secondary"
            >
              Back to dashboard
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (pending || (!config && loadError)) return (
    <div className="mx-auto w-full max-w-2xl rounded-2xl border border-accent/20 bg-bg-card p-6">
      <h1 className="text-xl font-heading font-bold text-text-primary">{pending ? "Your personal business check-in" : "Check-in unavailable"}</h1>
      <p className="mt-3 text-sm text-text-secondary">{pending ? "Gordy is preparing your weekly questions from your business consultation. Your check-in will appear here once he has approved and assigned it." : loadError}</p>
      <Link href="/portal" className="mt-5 inline-flex text-sm font-semibold text-accent-bright">Back to dashboard</Link>
    </div>
  );

  if (!config) {
    return (
      <div className="mx-auto w-full max-w-2xl">
        <div className="mb-8">
          <div className="animate-pulse bg-[rgba(0,0,0,0.08)] rounded-lg h-8 w-48 mb-2" />
          <div className="animate-pulse bg-[rgba(0,0,0,0.08)] rounded-lg h-4 w-72" />
        </div>
        <div className="space-y-6">
          <div>
            <div className="animate-pulse bg-[rgba(0,0,0,0.08)] rounded-lg h-4 w-52 mb-3" />
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="animate-pulse bg-[rgba(0,0,0,0.06)] rounded-xl h-12 border border-[rgba(0,0,0,0.08)]" />
              ))}
            </div>
          </div>
          {[...Array(3)].map((_, i) => (
            <div key={i}>
              <div className="animate-pulse bg-[rgba(0,0,0,0.08)] rounded-lg h-4 w-32 mb-2" />
              <div className="animate-pulse bg-[rgba(0,0,0,0.06)] rounded-xl h-24 border border-[rgba(0,0,0,0.08)]" />
            </div>
          ))}
          <div className="animate-pulse bg-[rgba(0,0,0,0.08)] rounded-xl h-14" />
        </div>
      </div>
    );
  }

  const enabledQuestions = config.questions.filter((q) => q.enabled !== false);
  const enabledMetrics = (config.progress_tracking || []).filter((m) => m.enabled);
  const tierInfo = monthlyReview ? {line:"Keep your weekly reflection up to date for Gordy’s monthly review.",lane:"Foundations",rhythm:"Submit weekly. Gordy responds monthly from your joining date."} : tierCopy[(tier as keyof typeof tierCopy) || "coached"] || tierCopy.coached;
  const effectiveCheckinDay = checkinDay || config.checkin_day || null;
  const nextCheckinDate = scheduledDate ? new Date(scheduledDate+"T00:00:00") : getCheckinDueDate(effectiveCheckinDay);
  const checkinOverdue = !currentWeekSubmitted && nextCheckinDate.getTime() < new Date(new Date().setHours(0, 0, 0, 0)).getTime();
  const dueLabel = editingHistory ? "Editing a saved check-in" : currentWeekSubmitted
    ? `Saved for ${scheduledDate || "this week"}`
    : isToday(nextCheckinDate)
      ? "Due today"
      : checkinOverdue
        ? `Overdue since ${nextCheckinDate.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short" })}`
      : `Next due ${nextCheckinDate.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short" })}`;

  return (
    <div className="mx-auto w-full max-w-2xl pb-28 sm:pb-0">
      <div className="mb-6">
        <h1 className="text-3xl font-heading font-bold text-text-primary">{config.title || "Weekly Check-in"}</h1>
        <p className="text-text-secondary mt-1">{businessCheckin ? "Your business numbers, wins and next steps for Gordy to review." : tierInfo.line}</p>
        {(tier === "premium" || tier === "vip") && (
          <div className={`mt-4 inline-flex items-center rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] ${
            tier === "vip"
              ? "border-amber-500/20 bg-amber-500/10 text-amber-500"
              : "border-sky-500/20 bg-sky-500/10 text-sky-500"
          }`}>
            {tierInfo.lane}
          </div>
        )}
      </div>

      {!editingHistory&&scheduledDates.length>0&&<label className="mb-4 block text-sm font-semibold text-text-primary">Scheduled check-in date<select aria-label="Scheduled check-in date" className="mt-2 w-full rounded-xl border border-white/10 bg-bg-card p-3" value={scheduledDate||""} onChange={event=>{window.location.href=`/portal/checkin?date=${event.target.value}`;}}>{scheduledDates.map(date=><option key={date} value={date}>{new Date(date+'T12:00:00Z').toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'short',year:'numeric',timeZone:'Europe/London'})}</option>)}</select><span className="mt-2 block text-xs font-normal text-text-secondary">Missed a week? Choose its scheduled date. Late check-ins keep their scheduled date and record when you actually submit. Enter measurements for that scheduled date; use Progress for current-day measurements.</span></label>}
      {history.length > 0 && <label className="mb-4 block text-sm font-semibold text-text-primary">Reopen a saved check-in<select aria-label="Reopen a saved check-in" className="mt-2 w-full rounded-xl border border-white/10 bg-bg-card p-3" value={editingHistory ? currentWeekId || "" : ""} onChange={e => { window.location.href = e.target.value ? `/portal/checkin?edit=${e.target.value}` : "/portal/checkin"; }}><option value="">Latest scheduled check-in</option>{history.map(item => <option key={item.id} value={item.id}>{item.scheduled_date ? `Scheduled ${item.scheduled_date} · submitted ${checkinDate(item.created_at)}` : checkinDate(item.created_at)} · Check-in {item.week_number}</option>)}</select></label>}
      {editingHistory && <p className="mb-4 rounded-xl border border-accent/30 p-4 text-sm text-text-primary">Editing the check-in {scheduledDate ? `scheduled for ${checkinDate(scheduledDate+"T12:00:00Z")}` : `from ${checkinDate(currentWeekSavedAt || "")}`}. Changes stay on that original date; Gordy’s previous reply is kept.</p>}
      {!businessCheckin && <Link href="/portal/progress" className="mb-4 inline-block text-sm text-accent-bright">Just logging weight? Open Progress →</Link>}
      {tierLoaded && canReadCoachCheckinReplies(tier) && (
      monthlyReview ? <section className="mb-6 rounded-2xl border border-[#E040D0]/20 bg-[#E040D0]/5 p-4"><h2 className="text-sm font-semibold text-[#E040D0]">Your monthly review</h2><p className="mt-2 text-sm text-text-secondary">Your check-ins stay weekly. Gordy reviews your month from your joining date. {monthlyReview.latest?.period_start===monthlyReview.periodStart ? `Next review due ${monthlyReview.nextDue}.` : `Review due ${monthlyReview.periodEnd}.`}</p>{monthlyReview.latest&&<><p className="mt-3 whitespace-pre-wrap text-sm text-text-primary">{monthlyReview.latest.response}</p><Link href={monthlyReview.latest.message_id?`/portal/inbox?message=${monthlyReview.latest.message_id}`:"/portal/inbox"} className="mt-3 inline-flex min-h-11 items-center text-sm font-semibold text-accent-bright">Read Gordy’s review in DMs →</Link></>}</section> : <CoachReplies replies={coachReplies} unavailable={repliesUnavailable} currentWeekId={currentWeekId} currentWeekSubmitted={currentWeekSubmitted} />
      )}

      <div className="mb-6 grid gap-3 sm:grid-cols-2">
        <div className="app-card-quiet app-rise app-rise-1 rounded-2xl p-4">
          <div className="text-[11px] uppercase tracking-[0.16em] text-text-muted">Check-in Rhythm</div>
          <div className="mt-2 text-lg font-heading font-bold text-text-primary">{formatDay(effectiveCheckinDay)}</div>
          <div className="mt-1 max-w-full break-words text-sm font-semibold leading-snug text-[#E040D0]">{dueLabel}</div>
          <div className="mt-1 text-sm text-text-secondary">{tierInfo.rhythm}</div>
        </div>
        <div className="app-card-quiet app-rise app-rise-2 rounded-2xl p-4">
          <div className="text-[11px] uppercase tracking-[0.16em] text-text-muted">Selected Check-in</div>
          <div className="mt-2 text-lg font-heading font-bold text-text-primary">
            {currentWeekSubmitted ? "Already saved" : "Still to submit"}
          </div>
          <div className="mt-1 text-sm text-text-secondary">
            {currentWeekSubmitted
              ? `Saved ${formatSavedAt(currentWeekSavedAt)}. You can reopen and correct this check-in.`
              : "You can reopen a saved check-in to add anything you missed. Weight can also be logged separately on the Progress page."}
          </div>
          {templateName && (
            <div className="mt-2 text-xs text-text-muted">Using form: {templateName}</div>
          )}
        </div>
      </div>

      {loadError && (
        <div className="mb-6 rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
          {loadError}
        </div>
      )}

      {/* Coach priorities context (Premium / VIP only) */}
      {(tier === "premium" || tier === "vip") && openCoachTasks.length > 0 && (
        <div className={`mb-6 rounded-2xl border px-4 py-4 ${
          tier === "vip" ? "border-amber-500/25 bg-amber-500/5" : "border-sky-500/25 bg-sky-500/5"
        }`}>
          <div className={`text-[10px] font-semibold uppercase tracking-[0.18em] ${
            tier === "vip" ? "text-amber-500" : "text-sky-500"
          }`}>
            Gordy&apos;s open priorities
          </div>
          <div className="mt-1 text-xs text-text-secondary">
            Reflect on these as you fill in this week&apos;s check-in — it keeps your reply focused on what matters.
          </div>
          <ul className="mt-3 space-y-2">
            {openCoachTasks.slice(0, 4).map((task) => (
              <li key={task.id} className="flex items-start gap-2 text-sm text-text-primary">
                <span className={`mt-1.5 inline-block h-1.5 w-1.5 rounded-full ${tier === "vip" ? "bg-amber-500" : "bg-sky-500"}`} />
                <span>{task.task_text}</span>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex gap-2">
            <Link href="/portal" className="text-xs font-semibold text-accent-bright no-underline hover:text-accent-light">
              Back to your dashboard
            </Link>
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Mood */}
        {config.mood_enabled && config.mood_options.length > 0 && (
          <section className="app-card app-rise rounded-[28px] p-5" aria-labelledby="weekly-mood-heading">
            <h2 id="weekly-mood-heading" className="mb-3 text-[13px] font-bold uppercase tracking-[0.16em] text-[#E040D0]">How are you feeling this week?</h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {config.mood_options.map((m) => (
                <ChoiceButton
                  key={m.value}
                  name="weekly_mood"
                  value={m.value}
                  onChange={() => setMood(m.value)}
                  selected={mood === m.value}
                  selectedClass={moodColorMap[m.color] || "border-accent/30 bg-accent/10 text-accent-bright"}
                  label={m.label}
                />
              ))}
            </div>
          </section>
        )}

        {/* Progress Photos */}
        {!businessCheckin && <PhotoUpload
          date={new Date().toISOString().split("T")[0]}
          onPhotosChange={setPhotos}
        />}

        {/* Dynamic questions */}
        {enabledQuestions.map((q) => {
          if (q.id === "photos") return null; // handled by PhotoUpload above
          if (q.type === "select" && q.options?.length) {
            return (
              <section key={q.id} className="app-card rounded-[28px] p-5" aria-labelledby={`question_${q.id}_heading`}>
                <h2 id={`question_${q.id}_heading`} className="mb-3 text-sm font-bold text-text-primary">{q.label}</h2>
                <div className="grid gap-3 sm:grid-cols-3">
                  {q.options.map((opt) => (
                    <ChoiceButton
                      key={opt}
                      name={`question_${q.id}`}
                      value={opt}
                      onChange={() => setResponses((prev) => ({ ...prev, [q.id]: opt }))}
                      selected={responses[q.id] === opt}
                      label={opt}
                    />
                  ))}
                </div>
              </section>
            );
          }
          if (q.type === "boolean" || q.type === "date" || q.type === "text") return (
            <section key={q.id} className="app-card rounded-[28px] p-5">
              <label htmlFor={`question_${q.id}`} className="mb-3 block text-sm font-bold text-text-primary">{q.label}{q.required ? " *" : ""}</label>
              {q.type === "boolean" ? <select id={`question_${q.id}`} required={q.required} value={responses[q.id] || ""} onChange={event => setResponses(previous => ({ ...previous, [q.id]: event.target.value }))} className="app-inset w-full rounded-2xl p-3 text-text-primary"><option value="">Choose</option><option value="true">Yes</option><option value="false">No</option></select> : <input id={`question_${q.id}`} type={q.type === "date" ? "date" : "text"} required={q.required} value={responses[q.id] || ""} onChange={event => setResponses(previous => ({ ...previous, [q.id]: event.target.value }))} className="app-inset w-full rounded-2xl p-3 text-text-primary" placeholder={q.placeholder} />}
            </section>
          );
          return (
            <section key={q.id} className="app-card rounded-[28px] p-5">
              <label htmlFor={`question_${q.id}`} className="mb-3 block text-sm font-bold text-text-primary">{q.label}</label>
              <textarea
                required={q.required}
                id={`question_${q.id}`}
                value={responses[q.id] || ""}
                onChange={(e) => setResponses((prev) => ({ ...prev, [q.id]: e.target.value }))}
                rows={3}
                placeholder={q.placeholder}
                className="app-inset w-full rounded-2xl px-4 py-3 text-text-primary text-sm placeholder:text-text-muted focus:outline-none focus:border-[#E040D0]/45 transition-colors resize-none"
              />
            </section>
          );
        })}

        {/* Progress Tracking */}
        {enabledMetrics.length > 0 && (
          <section className="app-card rounded-[28px] p-5">
            <div className="mb-4 text-[13px] font-bold uppercase tracking-[0.16em] text-[#E040D0]">Progress Tracking</div>
            {syncedMetricIds.length > 0 && (
              <div className="mb-4 rounded-2xl border border-emerald-500/20 bg-emerald-500/8 px-4 py-3">
                <div className="text-xs font-semibold text-emerald-500">Connected health added the factual readings it has.</div>
                <div className="mt-1 text-[11px] text-text-secondary">
                  {syncedMetricIds.map((id) => enabledMetrics.find((metric) => metric.id === id)?.label || id).join(", ")}
                  {syncedSummaryDate ? ` · ${new Date(`${syncedSummaryDate}T12:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}` : ""}
                  . You can edit them before sending.
                </div>
              </div>
            )}
            <div className="space-y-3">
              {enabledMetrics.map((m) => (
                <div key={m.id} className="rounded-2xl border border-[#E040D0]/15 bg-[linear-gradient(135deg,rgba(224,64,208,0.10),rgba(245,158,11,0.04))] px-3.5 py-3.5">
                  <div className="mb-2 text-sm font-bold text-text-primary">
                    {m.label}
                    {m.id === "weight" && !businessCheckin ? <select aria-label="Weight unit" value={weightUnit} onChange={e => { const next = e.target.value as WeightUnit; setProgressData(prev => ({ ...prev, weight: convertWeightInput(prev.weight || "", weightUnit, next) })); setWeightUnit(next); setConfig(prev => prev ? checkinConfigForWeightUnit(prev, next) : prev); }} className="ml-2 rounded border border-white/20 bg-bg-card px-2 py-1"><option value="kg">kg</option><option value="lb">lb</option></select> : m.unit && <span className="text-text-muted font-normal ml-1">({m.unit})</span>}
                  </div>
                  {m.type === "scale" ? (
                    <ScaleInput
                      metric={m}
                      value={progressData[m.id] || ""}
                      onChange={(v) => setProgressData((prev) => ({ ...prev, [m.id]: v }))}
                    />
                  ) : m.type === "select" && m.options?.length ? (
                    <select
                      aria-label={m.label}
                      value={progressData[m.id] || ""}
                      onChange={(e) => setProgressData((prev) => ({ ...prev, [m.id]: e.target.value }))}
                      className="w-full bg-bg-card border border-[rgba(0,0,0,0.06)] rounded-xl px-4 py-3 text-text-primary text-sm focus:outline-none focus:border-[#E040D0]/40 transition-colors"
                    >
                      <option value="" disabled>Select an option</option>
                      {m.options.map((opt) => (
                        <option key={opt} value={opt}>{opt}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="number"
                      aria-label={m.label}
                      step={m.kind === "count" ? "1" : "any"}
                      min={m.min}
                      max={m.max}
                      required={m.required}
                      value={progressData[m.id] || ""}
                      onChange={(e) => setProgressData((prev) => ({ ...prev, [m.id]: e.target.value }))}
                      placeholder={m.kind === "money" ? "Enter amount in GBP" : m.id === "weight" ? `Enter weight (${weightUnit})` : m.unit ? `Enter value (${m.unit})` : "Enter value"}
                      className="w-full bg-bg-card border border-[rgba(0,0,0,0.08)] rounded-xl px-4 py-3 text-text-primary text-sm placeholder:text-text-muted focus:outline-none focus:border-[#E040D0]/40 transition-colors"
                    />
                  )}
                  {syncedMetricIds.includes(m.id) && (
                    <div className="mt-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-emerald-500">Synced from connected health</div>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Extra support fields are enabled by the client's assigned setup. */}
        {(tier === "premium" || tier === "vip") && (
          <div className="app-card space-y-5 rounded-[28px] p-5">
            <div>
              <div className={`text-[10px] font-semibold uppercase tracking-[0.18em] ${
                tier === "vip" ? "text-amber-500" : "text-sky-500"
              }`}>
                Your main priority
              </div>
              <label className="mt-2 block text-sm font-medium text-text-primary">
                What&apos;s the main thing you want Gordy to understand this week?
              </label>
              <textarea
                value={priorityMessage}
                onChange={(e) => setPriorityMessage(e.target.value)}
                rows={3}
                placeholder="A win, challenge or decision you want Gordy to see first."
                className="app-inset mt-2 w-full rounded-2xl px-4 py-3 text-text-primary text-sm placeholder:text-text-muted focus:outline-none focus:border-[#E040D0]/45 transition-colors resize-none"
              />
            </div>
            <div>
              <div className={`text-[10px] font-semibold uppercase tracking-[0.18em] ${
                tier === "vip" ? "text-amber-500" : "text-sky-500"
              }`}>
                Support from Gordy
              </div>
              <label className="mt-2 block text-sm font-medium text-text-primary">
                What would be most useful from Gordy next?
              </label>
              <textarea
                value={supportAsk}
                onChange={(e) => setSupportAsk(e.target.value)}
                rows={3}
                placeholder="A review, answer, adjustment or accountability check..."
                className="app-inset mt-2 w-full rounded-2xl px-4 py-3 text-text-primary text-sm placeholder:text-text-muted focus:outline-none focus:border-[#E040D0]/45 transition-colors resize-none"
              />
            </div>
            <p className="text-xs leading-relaxed text-text-muted">
              These answers are included with your weekly check-in so Gordy can quickly see what matters. They are not sent as a separate DM.
            </p>
          </div>
        )}

        <button
          type="submit"
          disabled={(config.mood_enabled && !mood) || submitting || (!scheduledDate && !currentWeekId)}
          className="w-full py-4 gradient-accent text-white rounded-xl text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-opacity"
        >
          <CyclingStatusText
            active={submitting}
            idle={
              currentWeekSubmitted
                ? tier === "vip" || tier === "premium" ? "Update Check-in" : "Update Saved Check-in"
                : "Submit Check-in"
            }
            messages={["Saving...", "Uploading photos...", "Syncing progress...", "Nearly there..."]}
          />
        </button>
        <div className="text-center">
          <Link href="/portal" className="text-xs font-semibold text-text-muted no-underline hover:text-text-secondary">
            Back to dashboard
          </Link>
        </div>
        {error && (
          <p className="text-red-400 text-sm text-center">Something went wrong. Please try again.</p>
        )}
      </form>
    </div>
  );
}
