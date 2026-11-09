"use client";

import { Capacitor } from "@capacitor/core";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useToast } from "@/components/ui/Toast";
import CyclingStatusText from "@/components/ui/CyclingStatusText";
import { sanitizeWearableRecovery, type WearableDailySummary } from "@/lib/wearable-insights";
import { coachingDateKey, isValidTrackerDate, parseManualSteps, resolveDailySteps } from "@/lib/daily-steps";
import ScrollSafeRange from "@/components/ui/ScrollSafeRange";

type DailyMetric = {
  id: string;
  tracked_date: string;
  sleep_hours: number | null;
  water_liters: number | null;
  manual_steps: number | null;
  energy_level: number | null;
  stress_level: number | null;
  nutrition_score: number | null;
  training_completed: boolean;
  notes: string | null;
};

type SpeechRecognitionResultEvent = {
  results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }>;
};

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: SpeechRecognitionResultEvent) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

function formatDate(date: string) {
  return new Date(`${date}T00:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

function scoreEntry(entry: {
  sleep_hours?: number | string | null;
  water_liters?: number | string | null;
  energy_level?: number | "" | null;
  stress_level?: number | "" | null;
  nutrition_score?: number | "" | null;
  training_completed?: boolean;
}) {
  const energy = entry.energy_level === "" || entry.energy_level === null || entry.energy_level === undefined
    ? null
    : Number(entry.energy_level);
  const stress = entry.stress_level === "" || entry.stress_level === null || entry.stress_level === undefined
    ? null
    : 11 - Number(entry.stress_level);
  const nutrition = entry.nutrition_score === "" || entry.nutrition_score === null || entry.nutrition_score === undefined
    ? null
    : Number(entry.nutrition_score);
  const parts = [
    entry.sleep_hours ? Math.min(10, Math.max(1, (Number(entry.sleep_hours) / 8) * 10)) : null,
    entry.water_liters ? Math.min(10, Math.max(1, (Number(entry.water_liters) / 3) * 10)) : null,
    energy,
    stress,
    nutrition,
    entry.training_completed ? 10 : null,
  ].filter((value): value is number => typeof value === "number" && Number.isFinite(value));

  if (parts.length === 0) return null;
  return Math.round(parts.reduce((sum, value) => sum + value, 0) / parts.length);
}

function ScaleSlider({ label, value, onChange, lowLabel, highLabel }: {
  label: string;
  value: number | "";
  onChange: (value: number) => void;
  lowLabel: string;
  highLabel: string;
}) {
  const sliderValue = value === "" ? 1 : value;
  const percentage = value === "" ? 0 : ((sliderValue - 1) / 9) * 100;

  return (
    <div className="app-inset rounded-2xl p-3 min-[360px]:p-4">
      <div className="flex items-center justify-between gap-3">
        <label className="text-sm font-semibold text-text-primary">{label}</label>
        <output className="metric-num min-w-10 text-right text-xl font-bold text-accent-bright">{value || "—"}</output>
      </div>
      <ScrollSafeRange
        min="1"
        max="10"
        step="1"
        value={sliderValue}
        aria-label={`${label}, 1 to 10`}
        aria-valuetext={value ? `${value} out of 10` : "Not set"}
        onValueChange={next => onChange(Number(next))}
        className="range-shift"
        style={{ "--range-pct": `${percentage}%` } as React.CSSProperties}
      />
      <div className="flex items-center justify-between text-[11px] font-medium text-text-muted">
        <span>1 · {lowLabel}</span>
        <span>10 · {highLabel}</span>
      </div>
    </div>
  );
}

function TrackerCard({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="app-card app-rise rounded-[28px] p-4 min-[360px]:p-5 sm:p-6">
      <div className="mb-4">
        <h2 className="font-heading text-lg font-bold text-text-primary">{title}</h2>
        {hint && <p className="mt-1 text-sm text-text-secondary">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

export default function DailyTrackerPage() {
  const [timeZone, setTimeZone] = useState<string | null>(null);
  const todayKey = coachingDateKey(new Date(), timeZone || "Europe/London");
  const { toast } = useToast();
  const [entries, setEntries] = useState<DailyMetric[]>([]);
  const [loading, setLoading] = useState(true);
  const [trackerLoadFailed, setTrackerLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [wearableSummary, setWearableSummary] = useState<WearableDailySummary | null>(null);
  const [wearableSummaries, setWearableSummaries] = useState<WearableDailySummary[]>([]);
  const [listening, setListening] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);
  const [usesNativeKeyboardDictation, setUsesNativeKeyboardDictation] = useState(false);
  const [trainingDates, setTrainingDates] = useState<string[]>([]);
  const [syncedFields, setSyncedFields] = useState<string[]>([]);
  const speechRef = useRef<SpeechRecognitionLike | null>(null);
  const formRef = useRef<HTMLDivElement>(null);
  const loadSequence = useRef(0);
  const notesRef = useRef<HTMLTextAreaElement>(null);
  const [form, setForm] = useState({
    tracked_date: todayKey,
    sleep_hours: "",
    water_liters: "",
    manual_steps: "",
    energy_level: "" as number | "",
    stress_level: "" as number | "",
    nutrition_score: "" as number | "",
    training_completed: false,
    notes: "",
  });

  const score = useMemo(() => scoreEntry(form), [form]);
  const trainingAutoCompleted = trainingDates.includes(form.tracked_date);
  const manualSteps = parseManualSteps(form.manual_steps);
  const selectedSteps = resolveDailySteps(manualSteps.value, wearableSummary?.summary_date === form.tracked_date ? wearableSummary.steps : null);
  const sevenDayEntries = entries.slice(0, 7);
  const sevenDayScore = useMemo(() => {
    const scores = sevenDayEntries.map(scoreEntry).filter((value): value is number => value !== null);
    if (scores.length === 0) return null;
    return Math.round(scores.reduce((sum, value) => sum + value, 0) / scores.length);
  }, [sevenDayEntries]);

  const load = useCallback(async (selectedDate = coachingDateKey(new Date(), timeZone || "Europe/London")) => {
    if (!timeZone) return;
    const sequence = ++loadSequence.current;
    setLoading(true);
    setTrackerLoadFailed(false);
    try {
      const res = await fetch(`/api/portal/daily-tracker?date=${encodeURIComponent(selectedDate)}`, { headers: { "x-client-timezone": timeZone } });
      const data = await res.json();
      if (sequence !== loadSequence.current) return;
      if (!res.ok) throw new Error(data.error || "Failed to load tracker");
      const nextEntries = (data.entries || []) as DailyMetric[];
      const nextWearableSummaries = ((data.wearableSummaries || []) as WearableDailySummary[]).map(sanitizeWearableRecovery);
      const nextTrainingDates = Array.isArray(data.trainingDates)
        ? data.trainingDates.filter((date: unknown): date is string => typeof date === "string")
        : [];
      setEntries(nextEntries);
      setWearableSummaries(nextWearableSummaries);
      setTrainingDates(nextTrainingDates);
      const selectedWearable = data.selectedWearable?.summary_date === selectedDate
        ? sanitizeWearableRecovery(data.selectedWearable as WearableDailySummary)
        : nextWearableSummaries.find((summary) => summary.summary_date === selectedDate) || null;
      setWearableSummary(selectedWearable);
      const selectedEntry = data.selectedEntry as DailyMetric | null;
      if (selectedEntry) {
        setSyncedFields([
          selectedEntry.sleep_hours === null && selectedWearable?.sleep_minutes ? "sleep" : "",
          selectedEntry.water_liters === null && selectedWearable?.water_ml ? "water" : "",
        ].filter(Boolean));
        setForm({
          tracked_date: selectedEntry.tracked_date,
          manual_steps: selectedEntry.manual_steps?.toString() ?? "",
          sleep_hours: selectedEntry.sleep_hours?.toString()
            || (selectedWearable?.sleep_minutes ? (selectedWearable.sleep_minutes / 60).toFixed(1) : ""),
          water_liters: selectedEntry.water_liters?.toString()
            || (selectedWearable?.water_ml ? (selectedWearable.water_ml / 1000).toFixed(1) : ""),
          energy_level: selectedEntry.energy_level || "",
          stress_level: selectedEntry.stress_level || "",
          nutrition_score: selectedEntry.nutrition_score || "",
          training_completed: Boolean(selectedEntry.training_completed),
          notes: selectedEntry.notes || "",
        });
      } else {
        setSyncedFields([
          selectedWearable?.sleep_minutes ? "sleep" : "",
          selectedWearable?.water_ml ? "water" : "",
        ].filter(Boolean));
        setForm({
          tracked_date: selectedDate,
          manual_steps: "",
          energy_level: "",
          stress_level: "",
          nutrition_score: "",
          notes: "",
          sleep_hours: selectedWearable?.sleep_minutes ? (selectedWearable.sleep_minutes / 60).toFixed(1) : "",
          water_liters: selectedWearable?.water_ml ? (selectedWearable.water_ml / 1000).toFixed(1) : "",
          training_completed: nextTrainingDates.includes(selectedDate),
        });
      }
    } catch (err) {
      if (sequence === loadSequence.current) {
        setTrackerLoadFailed(true);
        toast(err instanceof Error ? err.message : "Failed to load tracker", "error");
      }
    } finally {
      if (sequence === loadSequence.current) setLoading(false);
    }
  }, [toast, timeZone]);

  useEffect(() => {
    setTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/London");
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const nativePlatform = Capacitor.isNativePlatform();
    setUsesNativeKeyboardDictation(nativePlatform);
    setSpeechSupported(!nativePlatform && Boolean(window.SpeechRecognition || window.webkitSpeechRecognition));
    return () => speechRef.current?.stop();
  }, []);

  async function save() {
    if (manualSteps.error) {
      toast(manualSteps.error, "error");
      return;
    }
    if (!isValidTrackerDate(form.tracked_date, todayKey)) {
      toast("Choose a valid date up to today.", "error");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/portal/daily-tracker", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-client-timezone": timeZone || "Europe/London" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save tracker");
      toast("Daily tracker saved");
      await load(form.tracked_date);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't save daily tracker", "error");
    } finally {
      setSaving(false);
    }
  }

  function selectDate(date: string) {
    if (saving || !isValidTrackerDate(date, todayKey)) return;
    speechRef.current?.stop();
    setListening(false);
    setWearableSummary(null);
    setSyncedFields([]);
    setForm({
      tracked_date: date,
      sleep_hours: "",
      water_liters: "",
      manual_steps: "",
      energy_level: "",
      stress_level: "",
      nutrition_score: "",
      training_completed: false,
      notes: "",
    });
    void load(date);
  }

  function selectEntry(entry: DailyMetric) {
    selectDate(entry.tracked_date);
    window.requestAnimationFrame(() => formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  function selectToday() {
    selectDate(todayKey);
  }

  function toggleDictation() {
    if (listening) {
      speechRef.current?.stop();
      return;
    }
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) return;
    const recognition = new Recognition();
    recognition.lang = "en-GB";
    recognition.continuous = false;
    recognition.interimResults = false;
    const dictationSequence = loadSequence.current;
    recognition.onresult = (event) => {
      if (dictationSequence !== loadSequence.current) return;
      const transcript = Array.from(event.results)
        .map((result) => result[0]?.transcript || "")
        .join(" ")
        .trim();
      if (transcript) {
        setForm((previous) => ({
          ...previous,
          notes: `${previous.notes}${previous.notes.trim() ? " " : ""}${transcript}`,
        }));
      }
    };
    recognition.onend = () => setListening(false);
    recognition.onerror = () => setListening(false);
    speechRef.current = recognition;
    setListening(true);
    recognition.start();
  }

  function openNativeDictation() {
    notesRef.current?.focus();
    toast("Tap the microphone on your iPhone keyboard to dictate your note");
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 pb-28 sm:pb-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <Link href="/portal" className="mb-3 inline-flex text-sm font-semibold text-accent-bright no-underline">
            ← Back to dashboard
          </Link>
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-accent-bright">Daily Tracker</p>
          <h1 className="mt-1 text-3xl font-heading font-bold text-text-primary">
            {form.tracked_date === todayKey ? "How today is going" : `Reviewing ${formatDate(form.tracked_date)}`}
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-text-secondary">
            Log the simple stuff Gordy cares about: sleep, water, steps, stress, energy, nutrition and whether training got done.
          </p>
        </div>
        <div className="app-rise w-full rounded-2xl border border-[#E040D0]/25 bg-[linear-gradient(150deg,#251426_0%,#1a1320_55%,#140f18_100%)] px-5 py-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_18px_40px_-22px_rgba(0,0,0,0.85)] sm:w-auto">
          <div className="text-[10px] uppercase tracking-[0.18em] text-[#F060E0]">
            {form.tracked_date === todayKey ? "Today score" : "Entry score"}
          </div>
          <div className="mt-1 text-3xl font-heading font-bold text-white">{score ?? "—"}/10</div>
          <div className="mt-1 text-xs text-white/70">7-day average: {sevenDayScore ?? "—"}/10</div>
        </div>
      </div>

      {wearableSummary && (
        <section className="overflow-hidden rounded-[26px] border border-white/[0.08] bg-[#151419] p-5 sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#ef68db]">Connected health</div>
              <h2 className="mt-1 text-lg font-semibold tracking-tight text-white">Health &amp; Capacity</h2>
              <p className="mt-1 text-xs leading-5 text-white/40">Synced data for {formatDate(wearableSummary.summary_date)}.</p>
            </div>
            <Link
              href="/portal/connected-apps"
              className="shrink-0 rounded-full border border-white/10 px-3 py-2 text-xs font-semibold text-white/60 no-underline"
            >
              View trends
            </Link>
          </div>
          <div className={`mt-5 grid grid-cols-2 gap-3 ${wearableSummary.providers.includes("myfitnesspal") ? "sm:grid-cols-4" : "sm:grid-cols-3"}`}>
            <SyncedMetric
              label="Readiness"
              value={wearableSummary.readiness_score !== null ? `${wearableSummary.readiness_score}/100` : "—"}
            />
            <SyncedMetric
              label="Sleep"
              value={wearableSummary.sleep_minutes !== null ? `${Math.floor(wearableSummary.sleep_minutes / 60)}h ${wearableSummary.sleep_minutes % 60}m` : "—"}
            />
            <SyncedMetric
              label="Synced steps"
              value={wearableSummary.steps !== null ? wearableSummary.steps.toLocaleString("en-GB") : "—"}
            />
            {wearableSummary.providers.includes("myfitnesspal") && (
              <SyncedMetric
                label="Protein"
                value={wearableSummary.protein_g !== null ? `${Math.round(wearableSummary.protein_g)}g` : "Awaiting MFP"}
              />
            )}
          </div>
          {wearableSummary.insight && (
            <p className="mt-4 border-l-2 border-[#e440d0]/60 pl-4 text-sm leading-6 text-white/55">
              {wearableSummary.insight}
            </p>
          )}
        </section>
      )}

      <fieldset disabled={loading || saving || trackerLoadFailed} aria-label="Daily tracker entry" className="contents">
      <div ref={formRef} className="scroll-mt-4">
      <TrackerCard
        title={form.tracked_date === todayKey ? "Today's basics" : formatDate(form.tracked_date)}
        hint={form.tracked_date === todayKey ? "The quick numbers first." : "Viewing a previous entry. Any changes will update this date."}
      >
        <div className="space-y-4">
          {form.tracked_date !== todayKey && (
            <button type="button" disabled={saving} onClick={selectToday} className="text-sm font-semibold text-accent-bright">
              Back to today
            </button>
          )}
          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-text-primary">Date</span>
            <input
              type="date"
              value={form.tracked_date}
              max={todayKey}
              disabled={saving}
              onChange={(e) => selectDate(e.target.value)}
              className="w-full min-w-0 rounded-2xl border border-[rgba(0,0,0,0.08)] bg-bg-primary px-4 py-3 text-base text-text-primary outline-none focus:border-accent/50 sm:text-sm"
            />
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-text-primary">Steps</span>
            <input
              inputMode="numeric"
              value={form.manual_steps}
              disabled={loading || saving}
              onChange={(event) => setForm((previous) => ({ ...previous, manual_steps: event.target.value }))}
              placeholder="e.g. 8000"
              aria-describedby="steps-help steps-total"
              aria-invalid={Boolean(manualSteps.error)}
              className="w-full rounded-2xl border border-[rgba(0,0,0,0.08)] bg-bg-primary px-4 py-3 text-text-primary outline-none placeholder:text-text-muted focus:border-accent/50"
            />
            <span id="steps-help" className="mt-2 block text-xs text-text-secondary">
              Leave blank to use synced steps. A manual entry replaces the synced total for this date.
            </span>
            <span id="steps-total" className="mt-1 block text-xs text-text-secondary" aria-live="polite">
              {manualSteps.error || (selectedSteps.value === null
                ? "No steps logged for this date."
                : `${selectedSteps.value.toLocaleString("en-GB")} steps · ${selectedSteps.source === "manual" ? "Manual" : "Synced"}`)}
            </span>
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            {syncedFields.includes("sleep") && wearableSummary?.summary_date === form.tracked_date && wearableSummary.sleep_minutes ? (
              <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/8 px-4 py-3">
                <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-500">Sleep synced</div>
                <div className="mt-1 text-lg font-heading font-bold text-text-primary">{form.sleep_hours} hours</div>
                <div className="mt-1 text-xs text-text-secondary">From {wearableSummary.providers.filter((provider) => provider !== "myfitnesspal").join(", ") || "your wearable"}</div>
              </div>
            ) : (
              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-text-primary">Sleep hours</span>
                <input
                  inputMode="decimal"
                  value={form.sleep_hours}
                  onChange={(e) => setForm((prev) => ({ ...prev, sleep_hours: e.target.value }))}
                  placeholder="e.g. 7.5"
                  className="w-full rounded-2xl border border-[rgba(0,0,0,0.08)] bg-bg-primary px-4 py-3 text-text-primary outline-none placeholder:text-text-muted focus:border-accent/50"
                />
              </label>
            )}
            {syncedFields.includes("water") && wearableSummary?.summary_date === form.tracked_date && wearableSummary.water_ml ? (
              <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/8 px-4 py-3">
                <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-500">Water synced</div>
                <div className="mt-1 text-lg font-heading font-bold text-text-primary">{form.water_liters} litres</div>
                <div className="mt-1 text-xs text-text-secondary">From MyFitnessPal</div>
              </div>
            ) : (
              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-text-primary">Water litres</span>
                <input
                  inputMode="decimal"
                  value={form.water_liters}
                  onChange={(e) => setForm((prev) => ({ ...prev, water_liters: e.target.value }))}
                  placeholder="e.g. 2.5"
                  className="w-full rounded-2xl border border-[rgba(0,0,0,0.08)] bg-bg-primary px-4 py-3 text-text-primary outline-none placeholder:text-text-muted focus:border-accent/50"
                />
              </label>
            )}
          </div>
        </div>
      </TrackerCard>
      </div>

      <TrackerCard title="How you're feeling" hint="Slide each rating from 1 to 10.">
        <div className="space-y-4">
          <ScaleSlider label="Energy" value={form.energy_level} lowLabel="Flat" highLabel="Excellent" onChange={(value) => setForm((prev) => ({ ...prev, energy_level: value }))} />
          <ScaleSlider label="Stress" value={form.stress_level} lowLabel="Calm" highLabel="Overloaded" onChange={(value) => setForm((prev) => ({ ...prev, stress_level: value }))} />
          <ScaleSlider label="Nutrition" value={form.nutrition_score} lowLabel="Off track" highLabel="On point" onChange={(value) => setForm((prev) => ({ ...prev, nutrition_score: value }))} />
        </div>
      </TrackerCard>

      <TrackerCard title="Training">
        <button
          type="button"
          disabled={trainingAutoCompleted}
          onClick={() => setForm((prev) => ({ ...prev, training_completed: !prev.training_completed }))}
          className={`w-full rounded-2xl border px-4 py-4 text-left transition-colors disabled:cursor-default ${
            form.training_completed
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-500"
              : "border-[rgba(0,0,0,0.08)] bg-bg-primary text-text-primary"
          }`}
        >
          <span className="block text-sm font-semibold">
            {trainingAutoCompleted
              ? "Training logged from your completed session"
              : form.training_completed
                ? "Training done today"
                : "Training not logged today"}
          </span>
          <span className="mt-1 block text-xs text-text-secondary">
            {trainingAutoCompleted ? "Updated automatically from Training." : "Tap to mark other training completed today."}
          </span>
        </button>
      </TrackerCard>

      <TrackerCard title="Notes">
        {usesNativeKeyboardDictation && (
          <button
            type="button"
            onClick={openNativeDictation}
            className="mb-3 inline-flex min-h-11 items-center gap-2 rounded-full border border-[#E040D0]/25 bg-[#E040D0]/8 px-4 text-xs font-semibold text-[#E040D0]"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 2a3 3 0 00-3 3v7a3 3 0 006 0V5a3 3 0 00-3-3zM5 10v2a7 7 0 0014 0v-2M12 19v3m-4 0h8" /></svg>
            Dictate with iPhone keyboard
          </button>
        )}
        {speechSupported && (
          <button
            type="button"
            onClick={toggleDictation}
            className={`mb-3 inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-xs font-semibold ${listening ? "border-red-500/30 bg-red-500/10 text-red-400" : "border-[#E040D0]/25 bg-[#E040D0]/8 text-[#E040D0]"}`}
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 2a3 3 0 00-3 3v7a3 3 0 006 0V5a3 3 0 00-3-3zM5 10v2a7 7 0 0014 0v-2M12 19v3m-4 0h8" /></svg>
            {listening ? "Stop listening" : "Add by voice"}
          </button>
        )}
        <textarea
          ref={notesRef}
          rows={4}
          value={form.notes}
          onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))}
          placeholder="Anything that explains the numbers?"
          className="w-full resize-none rounded-2xl border border-[rgba(0,0,0,0.08)] bg-bg-primary px-4 py-3 text-text-primary outline-none placeholder:text-text-muted focus:border-accent/50"
        />
        {usesNativeKeyboardDictation && (
          <p className="mt-2 text-[11px] text-text-muted">
            Tap the microphone on the iPhone keyboard. Your words stay editable and AT CAPACITY does not save the recording.
          </p>
        )}
        {speechSupported && <p className="mt-2 text-[11px] text-text-muted">Voice is turned into editable text; AT CAPACITY does not save the recording.</p>}
      </TrackerCard>

      <button
        type="button"
        onClick={save}
        disabled={saving || loading || trackerLoadFailed}
        className="w-full rounded-2xl gradient-accent px-5 py-4 text-sm font-semibold text-white disabled:opacity-50 sm:w-auto"
      >
        <CyclingStatusText active={saving} idle="Save daily tracker" messages={["Saving...", "Updating today...", "Checking streak...", "Nearly there..."]} />
      </button>
      </fieldset>
      {trackerLoadFailed && (
        <button type="button" onClick={() => load(form.tracked_date)} className="text-sm font-semibold text-accent-bright">
          Retry loading this date
        </button>
      )}

      <section className="app-card rounded-[28px] p-5 sm:p-6">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="font-heading text-xl font-bold text-text-primary">Recent days</h2>
            <p className="text-sm text-text-secondary">Quick read on consistency, not a judgment score.</p>
          </div>
        </div>
        {loading ? (
          <div className="text-sm text-text-muted">Loading tracker…</div>
        ) : entries.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[rgba(0,0,0,0.10)] p-5 text-sm text-text-secondary">
            No daily entries yet. Log today and this summary will start filling in.
          </div>
        ) : (
          <div className="space-y-3">
            {entries.slice(0, 7).map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => selectEntry(entry)}
                aria-current={entry.tracked_date === form.tracked_date ? "date" : undefined}
                className={`flex w-full items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-left transition-colors ${
                  entry.tracked_date === form.tracked_date
                    ? "border-accent/40 bg-accent/10"
                    : "border-[rgba(0,0,0,0.06)] bg-bg-primary hover:border-accent/25"
                }`}
              >
                <div>
                  <div className="text-sm font-semibold text-text-primary">{formatDate(entry.tracked_date)}</div>
                  <div className="mt-1 text-xs text-text-secondary">
                    {entry.sleep_hours ?? "—"}h sleep · {entry.water_liters ?? "—"}L water · energy {entry.energy_level ?? "—"}/10
                    {(() => {
                      const steps = resolveDailySteps(entry.manual_steps, wearableSummaries.find((summary) => summary.summary_date === entry.tracked_date)?.steps);
                      return steps.value === null ? null : ` · ${steps.value.toLocaleString("en-GB")} steps (${steps.source === "manual" ? "manual" : "synced"})`;
                    })()}
                  </div>
                </div>
                <div className="rounded-full border border-accent/20 bg-accent/10 px-3 py-1 text-sm font-semibold text-accent-bright">
                  {scoreEntry(entry) ?? "—"}/10
                </div>
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function SyncedMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-[rgba(0,0,0,0.06)] bg-bg-primary px-4 py-3">
      <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-text-muted">{label}</div>
      <div className="mt-1 text-lg font-heading font-bold text-text-primary">{value}</div>
    </div>
  );
}
