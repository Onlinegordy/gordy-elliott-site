"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { programmeSessionsForDate, programmeSessionsForCalendarWeek, programmeScheduledSessionForDate, programmeSessionCanBePlanned, programmeWeek, programmeAddDays } from "@/lib/exercise-programme";
import ManualTrainingActivityPanel from "@/components/portal/ManualTrainingActivity";
import { formatTrainingDate, occupiedTrainingDates, type ManualTrainingActivity } from "@/lib/training-calendar";
import { createPortal } from "react-dom";
import AtCapacityWorkoutRunner, { type WorkoutRunnerMode } from "@/components/portal/AtCapacityWorkoutRunner";
import type { ExerciseAlternative } from "@/components/portal/ExerciseSwapControl";
import NativeWorkoutLauncher from "@/components/native/NativeWorkoutLauncher";
import CyclingStatusText from "@/components/ui/CyclingStatusText";
import { formatExercisePrescription, shouldUseSetLogging } from "@/lib/exercise-prescriptions";
import { getExerciseDemoUrl } from "@/lib/exercise-demo";
import { openExerciseDemo } from "@/lib/exercise-demo-client";
import { previousWeightsForRestoredDraft, prefillPreviousWeights, forgetPreviousWeights, removeSetFromPreviousWeights, type PreviousExerciseLoads } from "@/lib/workout-previous-loads";
import { copyFirstWorkoutSetValues, removeExtraWorkoutSet, workoutSetHasValues, type WorkoutSetData } from "@/lib/workout-runner";
import { NATIVE_WORKOUT_SYNCED_EVENT } from "@/lib/native-workout";
import type { ClientExercisePlan, ExerciseSession, WeeklyTrainingAssignment, Exercise } from "@/lib/types";

type SetData = WorkoutSetData;

interface ExerciseLog {
  id: string;
  exercise_item_id: string;
  session_id: string;
  log_date: string;
  sets_data: SetData[];
  completed: boolean;
  notes: string | null;
  performed_exercise_id?: string;
  performed_exercise_name?: string;
  prescribed_exercise_name?: string;
  performed_exercise?: Exercise;
}

// ---- date helpers ----

function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getWeekStart(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay(); // 0=Sun
  const diff = day === 0 ? -6 : 1 - day; // Monday anchor
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function getWeekDays(weekStart: Date): Date[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    return d;
  });
}

function isToday(date: Date): boolean {
  return date.toDateString() === new Date().toDateString();
}

function isFuture(date: Date): boolean {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return date > today;
}

function weekLabel(weekStart: Date): string {
  const end = new Date(weekStart);
  end.setDate(end.getDate() + 6);
  const opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" };
  return `${weekStart.toLocaleDateString("en-GB", opts)} - ${end.toLocaleDateString("en-GB", opts)}`;
}

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function sessionTimerKey(planId: string, sessionId: string, date: string) {
  return `shift-session-timer:${planId}:${sessionId}:${date}`;
}

function activeSessionPointerKey(planId: string) {
  return `shift-active-session:${planId}`;
}

function formatElapsed(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function ElapsedTime({ startedAt }: { startedAt: number }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  return formatElapsed(now - startedAt);
}

// ---- rotation logic ----

function getNextSession(sessions: ExerciseSession[], allLogs: ExerciseLog[]): ExerciseSession {
  const sortedLogs = allLogs
    .filter((l) => l.session_id)
    .sort((a, b) => b.log_date.localeCompare(a.log_date));

  if (sortedLogs.length === 0) return sessions[0];

  const lastSessionId = sortedLogs[0].session_id;
  const lastIndex = sessions.findIndex((s) => s.id === lastSessionId);
  const nextIndex = (lastIndex + 1) % sessions.length;
  return sessions[nextIndex];
}

// Evenly-spaced training days within a Mon-anchored week, by sessions/week.
const WEEK_PATTERNS: Record<number, number[]> = {
  1: [0],
  2: [0, 3],
  3: [0, 2, 4],
  4: [0, 2, 4, 5],
  5: [0, 1, 2, 4, 5],
  6: [0, 1, 2, 3, 4, 5],
  7: [0, 1, 2, 3, 4, 5, 6],
};

function buildVirtualSchedule(plan: ClientExercisePlan, visibleWeekStart: Date): Map<string, ExerciseSession> {
  const map = new Map<string, ExerciseSession>();
  if (!plan.sessions?.length) return map;
  if (plan.programme_weeks) {
    for (const day of getWeekDays(visibleWeekStart)) {
      const date = formatDate(day);
      const session = programmeScheduledSessionForDate(plan, date);
      if (session) map.set(date, session);
    }
    return map;
  }
  const startRaw = plan.start_date || plan.created_at;
  const start = startRaw ? new Date(startRaw) : new Date();
  if (Number.isNaN(start.getTime())) return map;
  start.setHours(0, 0, 0, 0);

  const queue = [...plan.sessions].sort((a, b) => (a.day_number || 0) - (b.day_number || 0));
  const perWeekCounts = new Map<number, number>();

  for (const session of queue) {
    const week = Math.floor((Math.max(1, session.day_number || 1) - 1) / 7);
    perWeekCounts.set(week, (perWeekCounts.get(week) || 0) + 1);
  }

  const sessionsPerWeek = Math.min(7, Math.max(1, ...perWeekCounts.values()));
  const pattern = WEEK_PATTERNS[sessionsPerWeek];
  const startWeek = getWeekStart(start);
  const startDayIdx = Math.round((start.getTime() - startWeek.getTime()) / 86400000);

  let weekIndex = 0;
  while (queue.length > 0 && weekIndex < 80) {
    const days = weekIndex === 0 ? pattern.filter((idx) => idx >= startDayIdx) : pattern;
    for (const dayIdx of days) {
      const session = queue.shift();
      if (!session) break;
      const d = new Date(startWeek);
      d.setDate(d.getDate() + weekIndex * 7 + dayIdx);
      map.set(formatDate(d), session);
    }
    weekIndex += 1;
  }

  return map;
}

function buildSessionDrafts(session: ExerciseSession, existingLogs: ExerciseLog[] = []) {
  const drafts: Record<string, SetData[]> = {};
  for (const item of session.items) {
    if (item.exercise_id === "__section__") continue;
    const existing = existingLogs.find((log) => log.exercise_item_id === item.id)?.sets_data;
    if (Array.isArray(existing) && existing.length > 0) {
      drafts[item.id] = existing.map((set, index) => ({
        ...(typeof set.circuit_rounds === "number" ? { circuit_rounds: set.circuit_rounds } : {}),
        set_number: typeof set.set_number === "number" ? set.set_number : index + 1,
        weight: typeof set.weight === "string" ? set.weight : String(set.weight || ""),
        reps: typeof set.reps === "string" ? set.reps : String(set.reps || ""),
        notes: typeof set.notes === "string" ? set.notes : String(set.notes || ""),
        completed: typeof set.completed === "boolean"
          ? set.completed
          : Boolean(set.reps || set.weight || set.notes),
      }));
      continue;
    }
    const setsCount = shouldUseSetLogging(item) ? Number(item.sets) || 3 : 1;
    drafts[item.id] = Array.from({ length: setsCount }, (_, index) => ({
      set_number: index + 1,
      weight: "",
      reps: "",
      notes: "",
      completed: false,
    }));
  }
  return drafts;
}

// ---- component ----

export default function PortalExercisePlanPage() {
  const [plan, setPlan] = useState<ClientExercisePlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [planLoadError, setPlanLoadError] = useState<string | null>(null);
  const [allLogs, setAllLogs] = useState<ExerciseLog[]>([]);
  const [weeklyAssignments, setWeeklyAssignments] = useState<WeeklyTrainingAssignment[]>([]);
  const [plannerLoadedWeek, setPlannerLoadedWeek] = useState<string | null>(null);
  const [plannerLoading, setPlannerLoading] = useState(false);
  const [plannerError, setPlannerError] = useState<string | null>(null);
  const [plannerSavingSessionId, setPlannerSavingSessionId] = useState<string | null>(null);
  // Workouts moved into the visible week from another week (one-off client date moves).
  const [movedInAssignments, setMovedInAssignments] = useState<WeeklyTrainingAssignment[]>([]);
  const [calendarDateDrafts, setCalendarDateDrafts] = useState<Record<string, string>>({});
  const [manualActivities, setManualActivities] = useState<ManualTrainingActivity[]>([]);
  const [activityRefreshKey, setActivityRefreshKey] = useState(0);
  const plannerRequestIdRef = useRef(0);
  const resumePointerHandledRef = useRef<string | null>(null);
  const sessionPanelRef = useRef<HTMLDivElement | null>(null);

  // Calendar state
  const [weekStart, setWeekStart] = useState<Date>(() => getWeekStart(new Date()));
  const [selectedDate, setSelectedDate] = useState<Date>(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return today;
  });

  // Per-day session view
  const [activeSession, setActiveSession] = useState<ExerciseSession | null>(null);
  const [viewMode, setViewMode] = useState<"log" | "readonly">("log");
  const [showSessionPicker, setShowSessionPicker] = useState(false);
  const [manuallyPicked, setManuallyPicked] = useState(false);
  const [sessionOpen, setSessionOpen] = useState(false);
  const [runnerOpen, setRunnerOpen] = useState(false);
  const [runnerMode, setRunnerMode] = useState<WorkoutRunnerMode>("workout");
  const [sessionStartedAt, setSessionStartedAt] = useState<number | null>(null);

  // Draft inputs: exerciseItemId -> SetData[]
  const restoredDraftRef = useRef<{ key: string; sets: Record<string, SetData[]> } | null>(null);
  const [previousLoads, setPreviousLoads] = useState<{ key: string; data: PreviousExerciseLoads; error: string | null }>({ key: "", data: {}, error: null });
  const [draftSets, setDraftSets] = useState<Record<string, SetData[]>>({});
  const [performedExercises, setPerformedExercises] = useState<Record<string, Exercise>>({});
  const [alternatives, setAlternatives] = useState<Record<string, ExerciseAlternative[]>>({});
  const [alternativesLoaded, setAlternativesLoaded] = useState(false);
  useEffect(() => {
    setAlternativesLoaded(false);
    setAlternatives({});
    if (!activeSession) return;
    const controller = new AbortController();
    fetch(`/api/portal/exercise-alternatives?session_id=${activeSession.id}`, {signal:controller.signal})
      .then(response => response.ok ? response.json() : {alternatives:{}})
      .then(data => {if(!controller.signal.aborted) setAlternatives(data.alternatives || {});}).catch(()=>{}).finally(()=>{if(!controller.signal.aborted)setAlternativesLoaded(true);});
    return () => controller.abort();
  }, [activeSession]);
  const runnerSession = activeSession ? {...activeSession, items:activeSession.items.map(item => ({...item, exercise:performedExercises[item.id] || item.exercise}))} : null;
  const [saving, setSaving] = useState(false);
  const [savedToast, setSavedToast] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Changing dates loads only the needed programme weeks; retain historical session identities.
  const initialProgrammeDateSet = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    const from = formatDate(weekStart);
    const end = new Date(weekStart); end.setDate(end.getDate() + 6);
    setLoading(true);
    setPlanLoadError(null);
    fetch(`/api/portal/exercise-plan?from=${from}&to=${formatDate(end)}`, { signal: controller.signal })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Your training plan could not load. Please refresh and try again.");
        return data;
      })
      .then((data) => {
        if (controller.signal.aborted) return;
        setPlan(data.plan ?? null);
        if (data.plan?.programme_weeks && !initialProgrammeDateSet.current && data.today) {
          initialProgrammeDateSet.current = true;
          const today = new Date(`${data.today}T00:00:00`);
          setSelectedDate(today);
          setWeekStart(getWeekStart(today));
        }
      })
      .catch((error) => {
        if (error.name !== "AbortError" && !controller.signal.aborted) {
          setPlan(null); setActiveSession(null);
          setPlanLoadError(error.message || "Your training plan could not load. Please refresh and try again.");
        }
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [weekStart]);

  // Fetch logs for the visible week
  const fetchWeekLogs = useCallback(
    async (ws: Date) => {
      const from = formatDate(ws);
      const end = new Date(ws);
      end.setDate(end.getDate() + 6);
      const to = formatDate(end);
      try {
        const response = await fetch(`/api/portal/exercise-log?from=${from}&to=${to}`);
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data?.error || "Training logs could not be loaded");
        setAllLogs((prev) => {
          // Merge: remove old logs in this range, add new ones
          const filtered = prev.filter((l) => l.log_date < from || l.log_date > to);
          return [...filtered, ...(data.logs || [])];
        });
      } catch (error) {
        console.error("Failed to fetch training logs:", error);
      }
    },
    []
  );

  useEffect(() => {
    void fetchWeekLogs(weekStart);
  }, [weekStart, fetchWeekLogs]);

  useEffect(() => {
    const handleNativeWorkoutSynced = (event: Event) => {
      const detail = (event as CustomEvent<{ sessionId?: string; date?: string }>).detail;
      if (!detail?.sessionId || !detail.date) return;

      void fetchWeekLogs(weekStart);
      setActivityRefreshKey((key) => key + 1);
      if (detail.sessionId !== activeSession?.id || detail.date !== formatDate(selectedDate)) return;

      setSessionStartedAt(null);
      setRunnerOpen(false);
      setSessionOpen(false);
      setViewMode("readonly");
      setSavedToast(true);
      window.setTimeout(() => setSavedToast(false), 2500);
      if (plan?.id) {
        try {
          window.localStorage.removeItem(sessionTimerKey(plan.id, detail.sessionId, detail.date));
          window.localStorage.removeItem(activeSessionPointerKey(plan.id));
        } catch {
          // Native persistence remains the source of truth when browser storage is unavailable.
        }
      }
    };
    window.addEventListener(NATIVE_WORKOUT_SYNCED_EVENT, handleNativeWorkoutSynced);
    return () => window.removeEventListener(NATIVE_WORKOUT_SYNCED_EVENT, handleNativeWorkoutSynced);
  }, [activeSession?.id, fetchWeekLogs, plan?.id, selectedDate, weekStart]);

  const fetchWeekPlanner = useCallback(
    (ws: Date) => {
      if (!plan?.id) {
        setWeeklyAssignments([]);
        setMovedInAssignments([]);
        setPlannerLoadedWeek(null);
        return;
      }
      const week = formatDate(ws);
      const requestId = plannerRequestIdRef.current + 1;
      plannerRequestIdRef.current = requestId;
      setWeeklyAssignments([]);
      setMovedInAssignments([]);
      setPlannerLoadedWeek(null);
      setPlannerError(null);
      setPlannerLoading(true);
      fetch(`/api/portal/training-planner?plan_id=${plan.id}&week_start=${week}`)
        .then(async (r) => {
          const data = await r.json().catch(() => ({}));
          if (!r.ok) {
            throw new Error(data?.error || "Weekly planner could not load");
          }
          return data;
        })
        .then((data) => {
          if (requestId !== plannerRequestIdRef.current) return;
          setWeeklyAssignments(data.assignments || []);
          setMovedInAssignments(data.moved_in || []);
          setPlannerLoadedWeek(week);
          setPlannerError(null);
        })
        .catch((err) => {
          if (requestId !== plannerRequestIdRef.current) return;
          console.error("Failed to fetch weekly planner:", err);
          setWeeklyAssignments([]);
          setMovedInAssignments([]);
          setPlannerLoadedWeek(null);
          setPlannerError("Weekly planner could not load. Try refreshing the page.");
        })
        .finally(() => {
          if (requestId === plannerRequestIdRef.current) {
            setPlannerLoading(false);
          }
        });
    },
    [plan?.id],
  );

  useEffect(() => {
    fetchWeekPlanner(weekStart);
  }, [weekStart, fetchWeekPlanner]);

  const plannerLoadedForVisibleWeek = plannerLoadedWeek === formatDate(weekStart);
  const visibleWeeklyAssignments = useMemo(
    () => (plannerLoadedForVisibleWeek ? weeklyAssignments : []),
    [plannerLoadedForVisibleWeek, weeklyAssignments],
  );
  const visibleMovedIn = useMemo(
    () => (plannerLoadedForVisibleWeek ? movedInAssignments : []),
    [plannerLoadedForVisibleWeek, movedInAssignments],
  );
  const sortedSessions = useMemo(() => {
    if (!plan) return [];
    const date = formatDate(selectedDate);
    // Programme sessions are week-specific: a moved one is only available on its new date.
    const movedAway = new Set(plan.programme_weeks
      ? visibleWeeklyAssignments.filter((a) => a.moved_to && a.moved_to !== date).map((a) => a.session_id)
      : []);
    const own = programmeSessionsForDate(plan, date)
      .filter((session) => programmeSessionCanBePlanned(plan, session.id, date) && !movedAway.has(session.id));
    const movedHere = visibleMovedIn
      .filter((a) => a.planned_date === date && !own.some((session) => session.id === a.session_id))
      .flatMap((a) => plan.sessions.filter((session) => session.id === a.session_id));
    return [...own, ...movedHere];
  }, [plan, selectedDate, visibleWeeklyAssignments, visibleMovedIn]);

  const assignmentBySessionId = useMemo(() => {
    const map = new Map<string, WeeklyTrainingAssignment>();
    for (const assignment of visibleWeeklyAssignments) {
      map.set(assignment.session_id, assignment);
    }
    return map;
  }, [visibleWeeklyAssignments]);

  const plannedSessionsByDate = useMemo(() => {
    const map = new Map<string, ExerciseSession[]>();
    if (!plan?.sessions?.length) return map;

    for (const assignment of [...visibleWeeklyAssignments, ...visibleMovedIn]) {
      if (!assignment.planned_date) continue;
      const session = plan.sessions.find((s) => s.id === assignment.session_id);
      if (!session) continue;
      const list = map.get(assignment.planned_date) || [];
      if (!list.some((item) => item.id === session.id)) list.push(session);
      map.set(assignment.planned_date, list);
    }

    for (const sessions of map.values()) {
      sessions.sort((a, b) => (a.day_number || 0) - (b.day_number || 0));
    }

    return map;
  }, [plan?.sessions, visibleWeeklyAssignments, visibleMovedIn]);

  const fallbackSessionsByDate = useMemo(() => {
    const map = new Map<string, ExerciseSession[]>();
    if (!plan || !plannerLoadedForVisibleWeek || visibleWeeklyAssignments.length > 0) return map;

    const virtualSchedule = buildVirtualSchedule(plan, weekStart);
    for (const [date, session] of virtualSchedule.entries()) {
      map.set(date, [session]);
    }

    return map;
  }, [plan, weekStart, plannerLoadedForVisibleWeek, visibleWeeklyAssignments.length]);

  const calendarSessionsByDate = useMemo(() => {
    if (visibleWeeklyAssignments.length > 0 || fallbackSessionsByDate.size === 0) return plannedSessionsByDate;
    // Moved-in workouts sit on top of the suggested schedule for weeks the client has not planned.
    const map = new Map(fallbackSessionsByDate);
    for (const [date, sessions] of plannedSessionsByDate.entries()) {
      map.set(date, [...(map.get(date) || []), ...sessions.filter((session) => !map.get(date)?.some((item) => item.id === session.id))]);
    }
    return map;
  }, [visibleWeeklyAssignments.length, plannedSessionsByDate, fallbackSessionsByDate]);

  const initDrafts = useCallback((session: ExerciseSession, existingLogs: ExerciseLog[] = []) => {
    const history = !existingLogs.length && previousLoads.key === `${session.id}:${formatDate(selectedDate)}` ? previousLoads.data : {};
    const drafts = prefillPreviousWeights(buildSessionDrafts(session, existingLogs), history);
    setDraftSets(drafts);
    setPerformedExercises(Object.fromEntries(existingLogs.filter(log=>log.performed_exercise).map(log=>[log.exercise_item_id,log.performed_exercise!])));
    return drafts;
  }, [previousLoads, selectedDate]);

  // When selected date changes, figure out what session to show
  useEffect(() => {
    if (!plan?.sessions?.length) return;

    const dateStr = formatDate(selectedDate);
    const dayLogs = allLogs.filter((l) => l.log_date === dateStr && l.session_id);

    if (dayLogs.length > 0 && !manuallyPicked) {
      // Day already has a logged session — find which session
      const sessionId = dayLogs[0].session_id;
      const session = plan.sessions.find((s) => s.id === sessionId) ?? null;
      setActiveSession(session);
      setViewMode("readonly");
      setManuallyPicked(false);
      setSessionOpen(false);
    } else if (dayLogs.length === 0) {
      // No log for this day — use the auto-populated calendar (unless the
      // user explicitly picked a session). Days with nothing scheduled are
      // rest days and get Start Next Session / Add Session instead.
      if (!manuallyPicked) {
        const scheduled = calendarSessionsByDate.get(dateStr)?.[0] || null;
        if (scheduled) {
          setActiveSession(scheduled);
          initDrafts(scheduled);
        } else {
          setActiveSession(null);
          setSessionOpen(false);
        }
      }
      setViewMode("log");
    }
  }, [selectedDate, allLogs, plan, manuallyPicked, calendarSessionsByDate, initDrafts]);

  function updateSet(itemId: string, setIdx: number, field: keyof SetData, value: string | boolean | number) {
    if (field === "weight") {
      const number = draftSets[itemId]?.[setIdx]?.set_number ?? setIdx + 1;
      setPreviousLoads(previous => ({ ...previous, data: forgetPreviousWeights(previous.data, itemId, number) }));
    }
    setDraftSets((prev) => {
      const sets = [...(prev[itemId] || [])];
      sets[setIdx] = { ...sets[setIdx], [field]: value };
      return { ...prev, [itemId]: sets };
    });
  }

  function toggleSet(itemId: string, setIdx: number) {
    setDraftSets((prev) => {
      const sets = [...(prev[itemId] || [])];
      if (!sets[setIdx]) return prev;
      sets[setIdx] = { ...sets[setIdx], completed: !sets[setIdx].completed };
      return { ...prev, [itemId]: sets };
    });
  }

  function applyFirstSetToAll(itemId: string) {
    setPreviousLoads(previous => ({ ...previous, data: forgetPreviousWeights(previous.data, itemId) }));
    setDraftSets((prev) => {
      const sets = prev[itemId] || [];
      const first = sets[0];
      if (!first || sets.length < 2) return prev;
      return {
        ...prev,
        [itemId]: copyFirstWorkoutSetValues(sets),
      };
    });
  }

  function addSet(itemId: string) {
    setDraftSets((prev) => {
      const sets = prev[itemId] || [];
      return {
        ...prev,
        [itemId]: [...sets, { set_number: sets.length + 1, weight: "", reps: "", notes: "", completed: false }],
      };
    });
  }

  function removeSet(itemId: string, setIndex: number) {
    const item = activeSession?.items.find(item => item.id === itemId);
    const sets = draftSets[itemId] || [];
    if (!item || !shouldUseSetLogging(item) || !sets[setIndex]) return;
    const prescribedCount = Math.max(1, Number(item.sets) || 3);
    if (setIndex < prescribedCount) return;
    if (workoutSetHasValues(sets[setIndex]) && !window.confirm("Remove this extra set and its logged values? Your prescribed sets will stay.")) return;
    setPreviousLoads(previous => ({ ...previous, data: removeSetFromPreviousWeights(previous.data, itemId, sets, setIndex) }));
    setDraftSets(previous => ({ ...previous, [itemId]: removeExtraWorkoutSet(previous[itemId] || [], setIndex, prescribedCount) }));
  }

  async function saveSession(): Promise<boolean> {
    if (!activeSession) return false;
    const dateStr = formatDate(selectedDate);
    setSaving(true);
    setSaveError(null);
    try {
      const exercises = activeSession.items.filter((i) => i.exercise_id !== "__section__");
      const response = await fetch("/api/portal/exercise-log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: activeSession.id,
          date: dateStr,
          session_started_at: sessionStartedAt ? new Date(sessionStartedAt).toISOString() : undefined,
          entries: exercises.map((item) => ({
              exercise_item_id: item.id,
              sets_data: draftSets[item.id] || [],
              performed_exercise_id: performedExercises[item.id]?.id || item.exercise_id,
            })),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || "We couldn't save this session. Please try again.");

      // Refresh week logs; a logged workout replaces any manual rest-day marker for this date.
      await fetchWeekLogs(weekStart);
      if (data?.rest_day_cleared) setActivityRefreshKey((key) => key + 1);
      finishSessionTimer(activeSession.id, dateStr);
      setViewMode("readonly");
      setSessionOpen(false);
      setSavedToast(true);
      setTimeout(() => setSavedToast(false), 2500);
      return true;
    } catch (err) {
      console.error("Failed to save session:", err);
      setSaveError(err instanceof Error ? err.message : "We couldn't save this session.");
      return false;
    } finally {
      setSaving(false);
    }
  }

  function swapExercise(itemId: string, exercise: Exercise) {
    const item = activeSession?.items.find(item => item.id === itemId);
    if (!item || allLogs.some(log=>log.exercise_item_id===itemId&&log.log_date===formatDate(selectedDate))) return;
    setPreviousLoads(previous => ({ ...previous, data: forgetPreviousWeights(previous.data, itemId) }));
    setPerformedExercises(previous => ({...previous,[itemId]:exercise}));
    setDraftSets(previous => ({...previous,[itemId]:buildSessionDrafts({ ...activeSession!,items:[item] })[itemId]}));
  }

  // Derived
  const weekDays = getWeekDays(weekStart);

  function hasLogOnDay(date: Date): boolean {
    const dateStr = formatDate(date);
    return allLogs.some((l) => l.log_date === dateStr && l.completed);
  }

  function navigateWeek(delta: number) {
    setManuallyPicked(false);
    setSessionOpen(false);
    setWeekStart((prev) => {
      const d = new Date(prev);
      d.setDate(d.getDate() + delta * 7);
      return d;
    });
    setSelectedDate((prev) => {
      const d = new Date(prev);
      d.setDate(d.getDate() + delta * 7);
      d.setHours(0, 0, 0, 0);
      return d;
    });
  }

  function selectDay(day: Date) {
    const d = new Date(day);
    d.setHours(0, 0, 0, 0);
    setSelectedDate(d);
    setManuallyPicked(false);
    setSessionOpen(false);
  }

  function pickSession(session: ExerciseSession) {
    const existingLogs = dayLogs.filter((log) => log.session_id === session.id);
    setActiveSession(session);
    initDrafts(session, existingLogs);
    setViewMode(existingLogs.length > 0 ? "readonly" : "log");
    setRunnerMode(existingLogs.length > 0 ? "edit" : "workout");
    setManuallyPicked(true);
    setSessionOpen(true);
    setRunnerOpen(true);
    setShowSessionPicker(false);
  }

  async function savePlannerAssignment(
    sessionId: string,
    plannedDate: string | null,
    isRecurring?: boolean,
    recurrenceStopped?: boolean,
  ) {
    if (!plan) return;
    const existing = assignmentBySessionId.get(sessionId);
    const nextRecurring = Boolean(!plan.programme_weeks && plannedDate && (isRecurring ?? existing?.is_recurring));
    const nextRecurrenceStopped = Boolean(recurrenceStopped ?? existing?.recurrence_stopped);

    setPlannerSavingSessionId(sessionId);
    setPlannerError(null);
    try {
      const response = await fetch("/api/portal/training-planner", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plan_id: plan.id,
          session_id: sessionId,
          week_start: formatDate(weekStart),
          planned_date: plannedDate,
          is_recurring: nextRecurring,
          recurrence_stopped: nextRecurring ? false : nextRecurrenceStopped,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error || "Planner update failed");
      }

      const assignment = data.assignment as WeeklyTrainingAssignment;
      setPlannerLoadedWeek(formatDate(weekStart));
      setWeeklyAssignments((prev) => [
        ...prev.filter((item) => item.session_id !== sessionId),
        assignment,
      ]);

      if (!manuallyPicked) {
        const selected = formatDate(selectedDate);
        const movedSession = plan.sessions.find((session) => session.id === sessionId);
        const wasActive = activeSession?.id === sessionId;
        if (plannedDate === selected && movedSession) {
          setActiveSession(movedSession);
          initDrafts(movedSession);
          setViewMode("log");
        } else if (wasActive && existing?.planned_date === selected) {
          setActiveSession(null);
          setSessionOpen(false);
        }
      }
    } catch (err) {
      console.error("Failed to save weekly planner assignment:", err);
      setPlannerError(err instanceof Error ? err.message : "Planner update failed");
    } finally {
      setPlannerSavingSessionId(null);
    }
  }

  const selectedDateStr = formatDate(selectedDate);
  const dayLogs = allLogs.filter((l) => l.log_date === selectedDateStr);
  const isPast = !isToday(selectedDate) && !isFuture(selectedDate);
  const previousLoadsKey = activeSession ? `${activeSession.id}:${selectedDateStr}` : "";
  // Starting the timer or restoring a draft must not bypass history hydration.
  // prefillPreviousWeights only fills untouched blanks, preserving current work.
  const needsPreviousLoads = runnerOpen && runnerMode === "workout"
    && !dayLogs.some(log => log.session_id === activeSession?.id);
  const previousLoadsReady = !needsPreviousLoads || previousLoads.key === previousLoadsKey;
  useEffect(() => {
    if (!needsPreviousLoads || !activeSession || previousLoads.key === previousLoadsKey) return;
    const controller = new AbortController();
    let cancelled = false;
    const timeout = window.setTimeout(() => controller.abort(), 10_000);
    fetch(`/api/portal/exercise-previous-loads?session_id=${activeSession.id}&before=${selectedDateStr}`, { signal: controller.signal })
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Previous weights could not load.");
        if (cancelled) return;
        const history = restoredDraftRef.current?.key === previousLoadsKey
          ? previousWeightsForRestoredDraft(restoredDraftRef.current.sets, data.previousLoads || {})
          : data.previousLoads || {};
        setDraftSets(drafts => prefillPreviousWeights(drafts, history));
        setPreviousLoads({ key: previousLoadsKey, data: history, error: null });
      })
      .catch(() => {
        if (!cancelled) setPreviousLoads({ key: previousLoadsKey, data: {}, error: "Previous weights couldn't load. You can still enter today's weights." });
      })
      .finally(() => window.clearTimeout(timeout));
    return () => { cancelled = true; controller.abort(); window.clearTimeout(timeout); };
  }, [activeSession, needsPreviousLoads, previousLoads, previousLoadsKey, selectedDateStr]);
  const programmeNotStarted = Boolean(plan?.programme_weeks && plan.start_date && selectedDateStr < plan.start_date);

  // Keep the picker aligned with the active plan order.
  const weekSessions = sortedSessions;

  // Sessions logged in the visible week (for weekly summary trust signal)
  const weekStartStr = formatDate(weekStart);
  const weekEndDate = new Date(weekStart);
  weekEndDate.setDate(weekEndDate.getDate() + 6);
  const weekEndStr = formatDate(weekEndDate);
  const sessionsThisWeek = new Set(
    allLogs
      .filter((l) => l.log_date >= weekStartStr && l.log_date <= weekEndStr && l.completed && l.session_id)
      .map((l) => `${l.log_date}:${l.session_id}`),
  ).size;
  const totalPlanSessions = plan ? programmeSessionsForCalendarWeek(plan, formatDate(weekStart)).length : 0;
  const plannerSessions = plan ? programmeSessionsForCalendarWeek(plan, formatDate(weekStart)) : [];
  const plannerSessionIds = new Set(plannerSessions.map((session) => session.id));
  const isPlacedOrMoved = (assignment?: WeeklyTrainingAssignment) => Boolean(assignment?.planned_date || assignment?.moved_to);
  const placedSessionsCount = plannerSessions.filter((session) => isPlacedOrMoved(assignmentBySessionId.get(session.id))).length;
  const unassignedSessions = plannerSessions.filter((session) => !isPlacedOrMoved(assignmentBySessionId.get(session.id)));
  const movedOccurrences = [
    ...visibleMovedIn,
    ...visibleWeeklyAssignments.filter((assignment) => assignment.moved_to && !assignment.planned_date),
  ];
  const nextSession = sortedSessions.length > 0
    ? getNextSession(sortedSessions, allLogs.filter((log) => log.log_date <= selectedDateStr))
    : null;
  const primarySession = activeSession || nextSession;

  useEffect(() => {
    if (!plan?.id || resumePointerHandledRef.current === plan.id) return;
    try {
      const raw = window.localStorage.getItem(activeSessionPointerKey(plan.id));
      const pointer = raw ? JSON.parse(raw) as {
        sessionId?: string;
        date?: string;
        startedAt?: number;
        draftSets?: Record<string, SetData[]>;
      } : null;
      const session = pointer?.sessionId ? plan.sessions.find((item) => item.id === pointer.sessionId) : null;
      const date = pointer?.date ? new Date(`${pointer.date}T00:00:00`) : null;
      if (!session && date && !Number.isNaN(date.getTime()) && pointer?.startedAt && Date.now() - pointer.startedAt < 6 * 60 * 60 * 1000
        && getWeekStart(date).getTime() !== weekStart.getTime()) {
        setWeekStart(getWeekStart(date)); setSelectedDate(date); return;
      }
      resumePointerHandledRef.current = plan.id;
      const valid = session && date && !Number.isNaN(date.getTime()) && pointer?.startedAt && Date.now() - pointer.startedAt < 6 * 60 * 60 * 1000;
      if (!valid || !session || !date) {
        window.localStorage.removeItem(activeSessionPointerKey(plan.id));
        return;
      }
      setWeekStart(getWeekStart(date));
      setSelectedDate(date);
      setActiveSession(session);
      if (pointer.draftSets && typeof pointer.draftSets === "object") {
        restoredDraftRef.current = { key: `${session.id}:${pointer.date}`, sets: pointer.draftSets };
        setDraftSets(pointer.draftSets);
      } else {
        initDrafts(session);
      }
      setViewMode("log");
      setRunnerMode("workout");
      setManuallyPicked(true);
      setSessionOpen(true);
      setRunnerOpen(true);
    } catch {
      window.localStorage.removeItem(activeSessionPointerKey(plan.id));
    }
  }, [plan, initDrafts, weekStart]);

  useEffect(() => {
    if (!plan?.id || !activeSession || !sessionStartedAt || viewMode !== "log") return;
    const timeout = window.setTimeout(() => {
      try {
        window.localStorage.setItem(activeSessionPointerKey(plan.id), JSON.stringify({
          sessionId: activeSession.id,
          date: selectedDateStr,
          startedAt: sessionStartedAt,
          draftSets,
        }));
      } catch {
        // Draft persistence is best-effort when storage is unavailable.
      }
    }, 150);
    return () => window.clearTimeout(timeout);
  }, [activeSession, draftSets, plan?.id, selectedDateStr, sessionStartedAt, viewMode]);

  useEffect(() => {
    if (!plan?.id || !activeSession || viewMode !== "log") {
      setSessionStartedAt(null);
      return;
    }

    let startedAt: number | null = null;
    try {
      const raw = window.localStorage.getItem(sessionTimerKey(plan.id, activeSession.id, selectedDateStr));
      const parsed = raw ? Number(raw) : NaN;
      startedAt = Number.isFinite(parsed) && parsed > 0 ? parsed : null;
      if (startedAt && Date.now() - startedAt > 6 * 60 * 60 * 1000) {
        window.localStorage.removeItem(sessionTimerKey(plan.id, activeSession.id, selectedDateStr));
        window.localStorage.removeItem(activeSessionPointerKey(plan.id));
        startedAt = null;
      }
    } catch {
      startedAt = null;
    }
    setSessionStartedAt(startedAt);
    if (startedAt) setSessionOpen(true);
  }, [activeSession, plan?.id, selectedDateStr, viewMode]);

  function startSessionTimer(session: ExerciseSession) {
    if (!plan?.id) return;
    const existingLogs = dayLogs.filter((log) => log.session_id === session.id);
    const startingDrafts = activeSession?.id !== session.id || viewMode === "readonly"
      ? initDrafts(session, existingLogs)
      : draftSets;
    setActiveSession(session);
    setViewMode("log");
    setRunnerMode("workout");
    setManuallyPicked(true);
    const startedAt = Date.now();
    setSessionStartedAt(startedAt);
    setSessionOpen(true);
    setRunnerOpen(true);
    try {
      const pointerRaw = window.localStorage.getItem(activeSessionPointerKey(plan.id));
      const pointer = pointerRaw ? JSON.parse(pointerRaw) as { sessionId?: string; date?: string } : null;
      if (pointer?.sessionId && pointer.date && (pointer.sessionId !== session.id || pointer.date !== selectedDateStr)) {
        window.localStorage.removeItem(sessionTimerKey(plan.id, pointer.sessionId, pointer.date));
      }
      window.localStorage.setItem(sessionTimerKey(plan.id, session.id, selectedDateStr), String(startedAt));
      window.localStorage.setItem(activeSessionPointerKey(plan.id), JSON.stringify({
        sessionId: session.id,
        date: selectedDateStr,
        startedAt,
        draftSets: startingDrafts,
      }));
    } catch {
      // The timer still works for this visit when local storage is unavailable.
    }
  }

  function finishSessionTimer(sessionId: string, dateStr: string) {
    if (!plan?.id) return;
    setSessionStartedAt(null);
    try {
      window.localStorage.removeItem(sessionTimerKey(plan.id, sessionId, dateStr));
      const pointerRaw = window.localStorage.getItem(activeSessionPointerKey(plan.id));
      const pointer = pointerRaw ? JSON.parse(pointerRaw) as { sessionId?: string; date?: string } : null;
      if (pointer?.sessionId === sessionId && pointer.date === dateStr) {
        window.localStorage.removeItem(activeSessionPointerKey(plan.id));
      }
    } catch {
      // Completion persistence is best-effort.
    }
  }

  function openPrimarySession() {
    if (!primarySession) return;
    if (sessionStartedAt && activeSession?.id === primarySession.id) {
      setRunnerMode("workout");
      setSessionOpen(true);
      setRunnerOpen(true);
      return;
    }
    const existingLogs = dayLogs.filter((log) => log.session_id === primarySession.id);
    const editing = existingLogs.length > 0;
    setActiveSession(primarySession);
    initDrafts(primarySession, existingLogs);
    setViewMode(editing ? "readonly" : "log");
    setRunnerMode(editing ? "edit" : "workout");
    setManuallyPicked(true);
    setSessionOpen(true);
    setRunnerOpen(true);
  }

  function calendarDraftKey(sessionId: string, sourceWeek: string) {
    return `${sessionId}:${sourceWeek}`;
  }

  /** Moves one occurrence to an actual date. Same-week, one-off placements use the weekly planner. */
  async function saveCalendarDate(sessionId: string, date: string, sourceWeek: string, occurrence?: WeeklyTrainingAssignment) {
    if (!plan || !date) return;
    const target = new Date(`${date}T00:00:00`);
    const targetWeek = formatDate(getWeekStart(target));
    const draftKey = calendarDraftKey(sessionId, sourceWeek);
    if (targetWeek === sourceWeek && sourceWeek === weekStartStr && !occurrence?.moved_to && !occurrence?.is_recurring) {
      await savePlannerAssignment(sessionId, date, false);
      setCalendarDateDrafts((prev) => ({ ...prev, [draftKey]: "" }));
      return;
    }
    setPlannerSavingSessionId(sessionId);
    setPlannerError(null);
    try {
      const response = await fetch("/api/portal/training-calendar-date", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan_id: plan.id, session_id: sessionId, source_week_start: sourceWeek, planned_date: date }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Couldn't move this workout.");
      setCalendarDateDrafts((prev) => ({ ...prev, [draftKey]: "" }));
      setManuallyPicked(false);
      setSessionOpen(false);
      setSelectedDate(target);
      if (targetWeek === weekStartStr) fetchWeekPlanner(weekStart);
      else setWeekStart(getWeekStart(target));
    } catch (error) {
      setPlannerError(error instanceof Error ? error.message : "Couldn't move this workout.");
    } finally {
      setPlannerSavingSessionId(null);
    }
  }

  async function undoCalendarMove(sessionId: string, sourceWeek: string) {
    if (!plan) return;
    setPlannerSavingSessionId(sessionId);
    setPlannerError(null);
    try {
      const response = await fetch("/api/portal/training-calendar-date", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan_id: plan.id, session_id: sessionId, source_week_start: sourceWeek }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Couldn't undo this move.");
      setManuallyPicked(false);
      fetchWeekPlanner(weekStart);
    } catch (error) {
      setPlannerError(error instanceof Error ? error.message : "Couldn't undo this move.");
    } finally {
      setPlannerSavingSessionId(null);
    }
  }

  function dayChipClass(active: boolean, disabled: boolean) {
    return `min-w-10 rounded-lg border px-2.5 py-1.5 text-[11px] font-bold transition-colors ${
      active
        ? "border-[#E040D0] bg-[#E040D0] text-white"
        : "border-[rgba(0,0,0,0.08)] text-text-secondary hover:border-[#E040D0]/40 hover:text-[#E040D0]"
    } ${disabled ? "cursor-wait opacity-50" : "cursor-pointer"}`;
  }

  function renderPlannerDayChips(session: ExerciseSession, labelPrefix: string, occurrence?: WeeklyTrainingAssignment) {
    const assignment = occurrence
      ?? assignmentBySessionId.get(session.id)
      ?? (plannerSessionIds.has(session.id) ? undefined : visibleMovedIn.find((item) => item.session_id === session.id));
    const saving = plannerSavingSessionId === session.id;
    const sourceWeek = assignment?.source_week_start || weekStartStr;
    const movedIn = Boolean(assignment?.moved_to && assignment.source_week_start !== weekStartStr);
    const occupiedDates = occupiedTrainingDates(visibleWeeklyAssignments, visibleMovedIn, session.id);
    const draftKey = calendarDraftKey(session.id, sourceWeek);
    const draft = calendarDateDrafts[draftKey] || "";
    const minDate = plan?.programme_weeks && plan.start_date && plan.start_date > sourceWeek ? plan.start_date : sourceWeek;
    const currentDate = assignment?.moved_to || assignment?.planned_date || "";
    return (
      <div className="mt-3 space-y-3" aria-label={`${labelPrefix} ${session.name}`}>
        {assignment?.moved_to ? (
          <p className="rounded-xl bg-[#E040D0]/10 px-3 py-2 text-xs font-semibold leading-5 text-text-primary">
            {movedIn
              ? `Moved here from the week of ${formatTrainingDate(sourceWeek)}.`
              : `This week's ${session.name} is moved to ${formatTrainingDate(assignment.moved_to, true)}.`}
            {" "}Same workout, exercises and targets.
          </p>
        ) : (
          <div className="flex flex-wrap gap-1.5">{weekDays.map((day, i) => {
            const dayStr = formatDate(day);
            const active = assignment?.planned_date === dayStr;
            const occupiedBy = occupiedDates.get(dayStr);
            const occupied = Boolean(occupiedBy);
            const disabled = saving || active || occupied || Boolean(plan && !programmeSessionCanBePlanned(plan, session.id, dayStr));
            return (
              <button
                key={dayStr}
                type="button"
                disabled={disabled}
                onClick={() => savePlannerAssignment(session.id, dayStr, assignment?.is_recurring, assignment?.recurrence_stopped)}
                className={dayChipClass(active, disabled)}
                title={occupied
                  ? visibleWeeklyAssignments.some((item) => item.held_date === dayStr && item.session_id === occupiedBy)
                    ? "Kept for a moved workout until that move is undone"
                    : "That day already has a planned session"
                  : undefined}
                aria-pressed={active}
                aria-label={active
                  ? `${day.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}, assigned to ${session.name}`
                  : occupied
                    ? `${day.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}, unavailable because another session is planned`
                    : `Schedule ${session.name} for ${day.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}`}
              >
                {DAY_NAMES[i]} {day.getDate()}
              </button>
            );
          })}</div>
        )}
        <div className="flex min-w-0 flex-wrap items-end gap-2">
          <label className="block min-w-[11rem] flex-1 text-xs font-semibold text-text-primary">
            {assignment?.moved_to ? "Change the date" : "Or move it to any date, including next week"}
            <input
              type="date"
              aria-label={`New date for ${session.name}`}
              min={minDate}
              max={programmeAddDays(sourceWeek, 365)}
              value={draft || currentDate}
              onChange={(event) => setCalendarDateDrafts((prev) => ({ ...prev, [draftKey]: event.target.value }))}
              className="mt-1 block min-h-11 w-full min-w-0 rounded-xl border border-white/15 bg-bg-primary px-3 py-2 text-sm text-text-primary [color-scheme:dark]"
            />
          </label>
          <button
            type="button"
            disabled={saving || !draft || draft === currentDate}
            onClick={() => void saveCalendarDate(session.id, draft, sourceWeek, assignment)}
            className="min-h-11 rounded-xl bg-[#E040D0] px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
          >
            {saving ? "Saving..." : "Move"}
          </button>
          {assignment?.moved_to && (
            <button
              type="button"
              disabled={saving}
              onClick={() => void undoCalendarMove(session.id, sourceWeek)}
              className="min-h-11 rounded-xl border border-white/15 px-4 py-2 text-sm font-semibold text-text-secondary disabled:opacity-40"
            >
              {assignment.held_date ? `Undo move (back to ${formatTrainingDate(assignment.held_date)})` : "Undo move"}
            </button>
          )}
        </div>
        {draft && draft !== currentDate && (
          <p className="text-xs text-text-secondary">Moves only this week&apos;s {session.name} to {formatTrainingDate(draft, true)}. Your weekly pattern stays the same.</p>
        )}
      </div>
    );
  }

  // ---- render ----

  if (loading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-[rgba(0,0,0,0.06)] rounded-xl w-48" />
          <div className="h-32 bg-[rgba(0,0,0,0.06)] rounded-2xl" />
          <div className="h-64 bg-[rgba(0,0,0,0.06)] rounded-2xl" />
        </div>
      </div>
    );
  }

  if (planLoadError) {
    return <div className="p-6"><h1 className="text-2xl font-bold text-text-primary mb-4">My Training Plan</h1>
      <div role="alert" className="rounded-2xl border border-red-500/20 bg-red-500/5 p-6 text-sm text-text-secondary">{planLoadError}
        <button type="button" onClick={() => setWeekStart(new Date(weekStart))} className="mt-4 block rounded-xl bg-[#E040D0] px-4 py-3 font-semibold text-white">Try again</button>
      </div>
    </div>;
  }

  if (!plan) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-bold text-text-primary mb-4">My Training Plan</h1>
        <div className="bg-bg-card border border-[rgba(0,0,0,0.06)] rounded-2xl p-10 text-center">
          <svg className="w-16 h-16 mx-auto mb-4 text-text-secondary/30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
          </svg>
          <p className="text-text-secondary text-lg font-medium">No workout plan assigned yet</p>
          <p className="text-text-secondary/60 mt-1 text-sm">Your coach will set one up for you soon.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="pt-3 pb-40 sm:mx-auto sm:max-w-4xl sm:p-6 sm:pb-6 relative">
      {/* Toast */}
      {savedToast && (
        <div className="fixed top-5 left-1/2 -translate-x-1/2 z-50 bg-[#E040D0] text-white px-5 py-2.5 rounded-xl font-semibold shadow-lg text-sm">
          Session saved!
        </div>
      )}

      {/* First-screen training actions */}
      <div className="mb-5 space-y-3">
        <div className="app-hero app-rise app-rise-1 overflow-hidden rounded-[24px] p-4 text-white">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="mb-1 text-[11px] font-bold uppercase tracking-[0.24em] text-[#F7A8EE]">Training</div>
              <h1 className="text-2xl font-heading font-bold leading-tight text-white">{plan.name}</h1>
              {plan.programme_weeks && <p className="mt-2 text-xs font-semibold text-[#E667D6]">Week {programmeWeek(plan, formatDate(selectedDate))} of {plan.programme_weeks}</p>}
              <p className="mt-1 text-xs text-white/65">{sessionsThisWeek} logged this week · {placedSessionsCount}/{totalPlanSessions} scheduled</p>
            </div>
            <span className="rounded-full bg-white/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-white/75">
              {weekLabel(weekStart)}
            </span>
          </div>
        </div>

        <section className={`rounded-[24px] border bg-bg-card p-4 transition-all duration-300 ${
          sessionStartedAt
            ? "border-[#E040D0]/55 shadow-[0_0_0_1px_rgba(224,64,208,0.35),0_0_28px_rgba(224,64,208,0.25)]"
            : "border-white/[0.08]"
        }`}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#E667D6]">
                {sessionStartedAt ? "Session in progress" : activeSession ? "Selected session" : "Next in your plan"}
              </div>
              <h2 className="mt-1 text-xl font-heading font-bold text-text-primary">{primarySession?.name || "No session available"}</h2>
              <p className="mt-1 text-xs text-text-secondary">
                {selectedDate.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short" })}
                {primarySession ? ` · ${primarySession.items.filter((item) => item.exercise_id !== "__section__").length} exercises` : ""}
              </p>
            </div>
            {sessionStartedAt && (
              <span className="metric-num inline-flex shrink-0 items-center gap-2 rounded-full border border-[#E040D0]/30 bg-[#E040D0]/10 px-3 py-1.5 text-base font-bold text-[#F060E0]">
                <span className="h-2 w-2 animate-pulse rounded-full bg-[#F060E0]" />
                <ElapsedTime startedAt={sessionStartedAt} />
              </span>
            )}
          </div>
          <div className="mt-4 grid grid-cols-[1fr_auto] gap-2">
            <button
              type="button"
              onClick={openPrimarySession}
              disabled={!primarySession}
              className="min-h-12 rounded-xl bg-[#E040D0] px-4 py-3 text-sm font-bold text-white transition-colors hover:bg-[#F060E0] disabled:opacity-40"
            >
              {viewMode === "readonly" && activeSession ? "Edit logged session" : sessionStartedAt ? "Resume session" : activeSession ? "Start session" : "Start next session"}
            </button>
            <button
              type="button"
              onClick={() => setShowSessionPicker(true)}
              disabled={sortedSessions.length === 0}
              className="min-h-12 rounded-xl border border-[#E040D0]/30 px-4 py-3 text-sm font-semibold text-[#F060E0]"
            >
              Choose workout
            </button>
          </div>
        </section>

        {plan.overview && (
          <section aria-label="Plan overview" className="app-card rounded-[24px] border border-[#E040D0]/15 p-5">
            <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#E667D6]">Your plan</div>
            <h2 className="mt-1 font-heading text-lg font-bold text-text-primary">Plan overview</h2>
            <p className="mt-3 whitespace-pre-line text-sm leading-6 text-text-secondary">{plan.overview}</p>
          </section>
        )}

        <section className="app-card rounded-[24px] p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#E667D6]">Your Training Plan</div>
              <h2 className="mt-1 text-lg font-heading font-bold text-text-primary">Browse and schedule sessions</h2>
            </div>
            <span className="rounded-full border border-white/[0.08] px-3 py-1 text-xs font-semibold text-text-secondary">{sortedSessions.length} session{sortedSessions.length === 1 ? "" : "s"}</span>
          </div>
          {plannerLoading ? (
            <div className="mt-4 h-20 animate-pulse rounded-2xl bg-white/[0.04]" />
          ) : (
            <div className="mt-4 space-y-2">
              {sortedSessions.map((session) => {
                const assignment = assignmentBySessionId.get(session.id);
                const exerciseItems = session.items.filter((item) => item.exercise_id !== "__section__");
                return (
                  <details key={session.id} className="group rounded-2xl border border-white/[0.08] bg-white/[0.025] px-4 py-3">
                    <summary className="flex list-none items-center gap-3">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#E040D0]/10 text-sm font-bold text-[#F060E0]">{session.day_number}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-bold text-text-primary">{session.name}</span>
                        <span className="mt-0.5 block text-[11px] text-text-muted">
                          {exerciseItems.length} exercises{assignment?.moved_to ? ` · Moved to ${formatTrainingDate(assignment.moved_to)}` : assignment?.planned_date ? ` · ${new Date(`${assignment.planned_date}T00:00:00`).toLocaleDateString("en-GB", { weekday: "short" })}` : plannerSessionIds.has(session.id) ? " · Not scheduled" : " · Moved here"}
                        </span>
                      </span>
                      <svg className="h-4 w-4 shrink-0 text-text-muted transition-transform group-open:rotate-180" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="m6 9 6 6 6-6" /></svg>
                    </summary>
                    <div className="mt-3 border-t border-white/[0.06] pt-3">
                      <div className="space-y-2">
                        {exerciseItems.map((item) => (
                          <div key={item.id} className="flex items-start justify-between gap-3 text-sm">
                            <span className="text-text-secondary">{item.exercise?.name || "Exercise"}</span>
                            <span className="shrink-0 font-semibold text-[#F060E0]">{formatExercisePrescription(item)}</span>
                          </div>
                        ))}
                      </div>
                      <div className="mt-4 border-t border-white/[0.06] pt-3">
                        <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-text-muted">Choose a training day</div>
                        <p className="mt-1 text-[11px] leading-4 text-text-muted">
                          This adds the session to your week. It does not start the workout.
                        </p>
                        {renderPlannerDayChips(session, "Schedule")}
                        {assignment?.planned_date && !assignment.moved_to && (
                          <div className="mt-3 flex flex-wrap gap-2">
                            <button
                              type="button"
                              disabled={plannerSavingSessionId === session.id}
                              hidden={Boolean(plan.programme_weeks)}
                              onClick={() => savePlannerAssignment(session.id, assignment.planned_date, !assignment.is_recurring, assignment.is_recurring)}
                              className="rounded-xl border border-white/[0.10] px-3 py-2 text-[11px] font-semibold text-text-secondary"
                            >
                              {assignment.is_recurring ? "Stop weekly repeat" : "Repeat every week"}
                            </button>
                            <button
                              type="button"
                              disabled={plannerSavingSessionId === session.id}
                              onClick={() => savePlannerAssignment(session.id, null, false, assignment.recurrence_stopped)}
                              className="rounded-xl border border-amber-500/20 px-3 py-2 text-[11px] font-semibold text-amber-500"
                            >
                              Remove from this week
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </details>
                );
              })}
            </div>
          )}
          {plannerError && <p className="mt-3 text-sm text-red-400">{plannerError}</p>}
        </section>
      </div>

      {/* ---- Week Calendar Strip ---- */}
      <div className="app-card-quiet rounded-2xl p-4 mb-5">
        {/* Week nav */}
        <div className="flex items-center justify-between mb-3">
          <button
            onClick={() => navigateWeek(-1)}
            className="p-1.5 rounded-lg hover:bg-[rgba(0,0,0,0.05)] transition-colors cursor-pointer"
            aria-label="Previous week"
          >
            <svg className="w-4 h-4 text-text-secondary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-text-secondary">{weekLabel(weekStart)}</span>
            <button
              onClick={() => {
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                setWeekStart(getWeekStart(today));
                setSelectedDate(today);
              }}
              className="rounded-lg border border-[rgba(0,0,0,0.08)] px-2.5 py-1 text-[11px] font-semibold text-text-secondary transition-colors hover:text-text-primary hover:border-[#E040D0]/30 cursor-pointer"
            >
              Today
            </button>
            <button
              onClick={() => navigateWeek(1)}
              className="p-1.5 rounded-lg hover:bg-[rgba(0,0,0,0.05)] transition-colors cursor-pointer"
              aria-label="Next week"
            >
              <svg className="w-4 h-4 text-text-secondary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
        </div>

        {/* Day buttons */}
        <div className="grid grid-cols-7 gap-1 pb-1">
          {weekDays.map((day, i) => {
            const dayStr = formatDate(day);
            const isSelected = dayStr === selectedDateStr;
            const todayDay = isToday(day);
            const hasLog = hasLogOnDay(day);
            const hasPlanned = Boolean(calendarSessionsByDate.get(dayStr)?.length);
            const activity = manualActivities.find((entry) => entry.activity_date === dayStr);

            return (
              <button
                key={i}
                onClick={() => selectDay(day)}
                aria-label={`${day.toLocaleDateString("en-GB", {
                  weekday: "long",
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })}${hasLog ? ", workout logged" : hasPlanned ? ", workout planned" : ""}${activity ? `, ${activity.kind === "rest" ? "rest day" : "other activity"} recorded` : ""}`}
                data-training-date={dayStr}
                className={`relative flex min-w-0 flex-col items-center justify-center rounded-xl px-0.5 py-2.5 transition-all cursor-pointer
                  ${todayDay
                    ? "bg-[#E040D0] text-white"
                    : isSelected
                    ? "border-2 border-[#E040D0] text-text-primary bg-[rgba(224,64,208,0.06)]"
                    : "hover:bg-[rgba(0,0,0,0.04)] text-text-secondary border-2 border-transparent"
                  }`}
              >
                <span className="text-[10px] font-semibold uppercase tracking-wide mb-0.5">
                  {DAY_NAMES[i]}
                </span>
                <span className="text-sm font-bold leading-none">{day.getDate()}</span>
                {activity && <span className="mt-1 text-[9px] font-semibold uppercase leading-none">{activity.kind === "rest" ? "Rest" : "Active"}</span>}
                {/* Dot indicator: solid = logged, faded = session planned */}
                <div className={`mt-1.5 w-1.5 h-1.5 rounded-full transition-all ${
                  hasLog
                    ? `opacity-100 ${todayDay ? "bg-white" : "bg-[#E040D0]"}`
                    : hasPlanned
                    ? `opacity-60 ${todayDay ? "bg-white" : "bg-[#E040D0]"}`
                    : "opacity-0"
                }`} />
              </button>
            );
          })}
        </div>
      </div>

      <ManualTrainingActivityPanel
        date={selectedDateStr}
        weekStart={weekStartStr}
        weekEnd={weekEndStr}
        refreshKey={activityRefreshKey}
        workoutLogged={hasLogOnDay(selectedDate)}
        onChange={setManualActivities}
      />

      {/* ---- Weekly Planner ---- */}
      <details className="group app-card rounded-[28px] p-4 mb-5">
        <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 [&::-webkit-details-marker]:hidden">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#E667D6]">Adjust this week</div>
            <h2 className="mt-1 text-base font-heading font-bold text-text-primary">
              {placedSessionsCount}/{totalPlanSessions} sessions placed
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <div className={`rounded-xl border px-3 py-2 text-xs font-semibold ${
              unassignedSessions.length > 0
                ? "border-amber-500/25 bg-amber-500/10 text-amber-500"
                : "border-emerald-500/25 bg-emerald-500/10 text-emerald-500"
            }`}>
              {unassignedSessions.length > 0
                ? `${unassignedSessions.length} to schedule`
                : "Week ready"}
            </div>
            <svg className="h-4 w-4 text-text-muted transition-transform group-open:rotate-180" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
          </div>
        </summary>

        <div className="-mx-1 mt-4 flex snap-x gap-2 overflow-x-auto px-1 pb-1 sm:mx-0 sm:grid sm:grid-cols-7 sm:overflow-visible sm:px-0">
          {weekDays.map((day, i) => {
            const dayStr = formatDate(day);
            const planned = plannedSessionsByDate.get(dayStr) || [];
            return (
              <button
                key={dayStr}
                type="button"
                onClick={() => selectDay(day)}
                className={`min-h-[92px] w-[8.25rem] shrink-0 snap-start rounded-2xl border p-3 text-left transition-colors cursor-pointer sm:w-auto sm:shrink ${
                  selectedDateStr === dayStr
                    ? "border-[#E040D0] bg-[#E040D0]/8"
                    : "border-[rgba(0,0,0,0.06)] bg-[rgba(0,0,0,0.015)] hover:border-[#E040D0]/30"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-text-muted">{DAY_NAMES[i]}</span>
                  <span className="text-xs font-heading font-bold text-text-primary">{day.getDate()}</span>
                </div>
                <div className="mt-2 space-y-1">
                  {planned.length > 0 ? planned.map((session) => (
                    <div key={session.id} className="line-clamp-2 rounded-lg bg-[#E040D0]/10 px-2 py-1 text-[11px] font-semibold leading-4 text-[#E040D0]">
                      {session.name}
                    </div>
                  )) : (
                    <div className="text-[11px] text-text-muted">Open</div>
                  )}
                </div>
              </button>
            );
          })}
        </div>

        {plannerLoading ? (
          <div className="mt-4 rounded-2xl border border-[rgba(0,0,0,0.06)] px-4 py-3 text-sm text-text-muted">
            Loading weekly planner...
          </div>
        ) : (
          <div className="mt-5 space-y-4">
            {plannerError && (
              <div className="rounded-2xl border border-red-500/20 bg-red-500/8 px-4 py-3 text-sm font-semibold text-red-400">
                {plannerError}
              </div>
            )}
            {unassignedSessions.length > 0 && (
              <div>
                <h3 className="text-xs font-bold uppercase tracking-[0.16em] text-amber-500">Choose a day</h3>
                <p className="mt-1 text-xs leading-5 text-text-muted">
                  Tap a day to put each workout into this week. You can still choose a different workout when you train.
                </p>
                <div className="mt-2 space-y-2">
                  {unassignedSessions.map((session) => (
                    <div key={session.id} className="rounded-2xl border border-amber-500/15 bg-amber-500/5 px-4 py-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-sm font-bold text-text-primary">{session.name}</div>
                          <div className="mt-0.5 text-[11px] text-text-muted">Session {session.day_number}</div>
                        </div>
                        {plannerSavingSessionId === session.id && (
                          <span className="text-[11px] font-semibold text-text-muted">Saving...</span>
                        )}
                      </div>
                      {renderPlannerDayChips(session, "Schedule")}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {sortedSessions.some((session) => assignmentBySessionId.get(session.id)?.planned_date) && (
              <div>
                <h3 className="text-xs font-bold uppercase tracking-[0.16em] text-text-muted">Scheduled sessions</h3>
                <div className="mt-2 space-y-2">
                  {sortedSessions.map((session) => {
                    const assignment = assignmentBySessionId.get(session.id);
                    if (!assignment?.planned_date) return null;
                    const plannedLabel = new Date(`${assignment.planned_date}T00:00:00`).toLocaleDateString("en-GB", {
                      weekday: "short",
                      day: "numeric",
                      month: "short",
                    });
                    const saving = plannerSavingSessionId === session.id;
                    return (
                      <details key={session.id} className="group/session rounded-2xl border border-[rgba(0,0,0,0.06)] bg-[rgba(0,0,0,0.012)]">
                        <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-bold text-text-primary">{session.name}</div>
                            <div className="mt-1 flex flex-wrap gap-1.5">
                              <span className="rounded-full bg-[#E040D0]/10 px-2.5 py-1 text-[11px] font-semibold text-[#E040D0]">
                                {plannedLabel}
                              </span>
                              {assignment.is_recurring && !assignment.moved_to && (
                                <span className="rounded-full bg-emerald-500/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-500">
                                  Weekly
                                </span>
                              )}
                              {assignment.moved_to && (
                                <span className="rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-semibold text-text-secondary">
                                  Moved
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            {saving && <span className="text-[11px] font-semibold text-text-muted">Saving...</span>}
                            <span className="text-[11px] font-semibold text-text-muted">Change</span>
                            <svg className="h-4 w-4 text-text-muted transition-transform group-open/session:rotate-180" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                          </div>
                        </summary>
                        <div className="border-t border-[rgba(0,0,0,0.05)] px-4 pb-4 pt-3">
                          <p className="text-[11px] text-text-muted">Move this workout to another day:</p>
                          {renderPlannerDayChips(session, "Move")}
                          <div className="mt-3 flex flex-wrap gap-2" hidden={Boolean(assignment.moved_to)}>
                            <button
                              type="button"
                              disabled={saving}
                              hidden={Boolean(plan.programme_weeks)}
                              onClick={() => savePlannerAssignment(session.id, assignment.planned_date, !assignment.is_recurring, assignment.is_recurring)}
                              className="rounded-xl border border-[rgba(0,0,0,0.08)] px-3 py-2 text-[11px] font-semibold text-text-secondary transition-colors hover:border-[#E040D0]/35 hover:text-[#E040D0] disabled:opacity-50"
                            >
                              {assignment.is_recurring ? "Stop weekly repeat" : "Repeat every week"}
                            </button>
                            <button
                              type="button"
                              disabled={saving}
                              onClick={() => savePlannerAssignment(session.id, null, false, assignment.recurrence_stopped)}
                              className="rounded-xl border border-amber-500/20 px-3 py-2 text-[11px] font-semibold text-amber-500 transition-colors hover:bg-amber-500/10 disabled:opacity-50"
                            >
                              Remove from this week
                            </button>
                          </div>
                          {assignment.source === "recurring" && (
                            <p className="mt-3 text-[11px] text-text-muted">This session was placed by your recurring weekly plan.</p>
                          )}
                        </div>
                      </details>
                    );
                  })}
                </div>
              </div>
            )}

            {movedOccurrences.length > 0 && (
              <div>
                <h3 className="text-xs font-bold uppercase tracking-[0.16em] text-text-muted">Moved workouts</h3>
                <div className="mt-2 space-y-2">
                  {movedOccurrences.map((occurrence) => {
                    const session = plan.sessions.find((item) => item.id === occurrence.session_id);
                    if (!session || !occurrence.moved_to) return null;
                    const incoming = occurrence.source_week_start !== weekStartStr;
                    return (
                      <div key={`${occurrence.session_id}:${occurrence.source_week_start}`} className="rounded-2xl border border-[#E040D0]/20 bg-[#E040D0]/5 px-4 py-3">
                        <div className="text-sm font-bold text-text-primary">{session.name}</div>
                        <div className="mt-0.5 text-[11px] text-text-secondary">
                          {incoming
                            ? `${formatTrainingDate(occurrence.moved_to)} · moved from the week of ${formatTrainingDate(occurrence.source_week_start || weekStartStr)}`
                            : `Moved out of this week to ${formatTrainingDate(occurrence.moved_to, true)}`}
                        </div>
                        {renderPlannerDayChips(session, "Moved", occurrence)}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </details>

      {/* ---- Rest day: nothing scheduled on this date ---- */}
      {!activeSession && (
        <div className="app-card rounded-[28px] p-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-[#E040D0]/10">
            <svg className="h-6 w-6 text-[#F060E0]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
            </svg>
          </div>
          <h2 className="text-lg font-heading font-bold text-text-primary">{programmeNotStarted ? "Your programme starts soon" : "Rest day"}</h2>
          <p className="mx-auto mt-1 max-w-xs text-sm text-text-secondary">
            {programmeNotStarted ? `Your first programme week starts on ${plan.start_date}.` : isPast
              ? "No session was scheduled for this day."
              : "Nothing scheduled. Recovery is part of the programme — take it."}
          </p>
          {!isPast && (
            <div className="mt-5 flex flex-col items-center justify-center gap-2 sm:flex-row">
              <button
                type="button"
                disabled={sortedSessions.length === 0}
                onClick={() => {
                  if (!sortedSessions.length) return;
                  const next = getNextSession(sortedSessions, allLogs.filter((log) => log.log_date <= selectedDateStr));
                  pickSession(next);
                }}
                className="w-full rounded-xl gradient-accent px-5 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 cursor-pointer sm:w-auto"
              >
                Start Next Session
              </button>
              <button
                type="button"
                onClick={() => setShowSessionPicker(true)}
              disabled={sortedSessions.length === 0}
                className="w-full rounded-xl border border-[#E040D0]/30 px-5 py-2.5 text-sm font-semibold text-[#F060E0] transition-colors hover:bg-[#E040D0]/10 cursor-pointer sm:w-auto"
              >
                Choose Workout
              </button>
            </div>
          )}
        </div>
      )}

      {/* ---- Selected Day Content ---- */}
      {activeSession && (
        <div ref={sessionPanelRef} className={`app-card scroll-mt-4 rounded-[28px] overflow-hidden transition-all duration-300 ${
          sessionStartedAt
            ? "border-[#E040D0]/55 shadow-[0_0_0_1px_rgba(224,64,208,0.35),0_0_28px_rgba(224,64,208,0.25)]"
            : ""
        }`}>
          <button
            type="button"
            onClick={() => {
              if (viewMode === "log") {
                setRunnerMode("workout");
                setRunnerOpen(true);
                return;
              }
              setSessionOpen((open) => !open);
            }}
            className="w-full p-5 text-left app-tap"
            aria-expanded={sessionOpen}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-[#E040D0] uppercase tracking-wider mb-1">
                  {viewMode === "readonly" ? "Logged session" : isToday(selectedDate) ? "Next session" : isPast ? "Retro session" : "Planned session"}
                </p>
                <h2 className="text-xl font-bold text-text-primary">{activeSession.name}</h2>
                {activeSession.notes && (
                  <p className="text-sm text-text-secondary mt-1 italic">{activeSession.notes}</p>
                )}
              </div>
              <div className="flex flex-col items-end gap-2 flex-shrink-0">
                {sessionStartedAt ? (
                  <span className="metric-num inline-flex items-center gap-1.5 rounded-full border border-[#E040D0]/30 bg-[#E040D0]/10 px-3 py-1 text-sm font-bold text-[#F060E0]">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#F060E0]" />
                    <ElapsedTime startedAt={sessionStartedAt} />
                  </span>
                ) : (
                  <span className={`rounded-full border px-3 py-1 text-xs font-bold uppercase tracking-wider ${
                    viewMode === "readonly"
                      ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-500"
                      : "border-[#E040D0]/25 bg-[#E040D0]/10 text-[#E040D0]"
                  }`}>
                    {viewMode === "readonly" ? "Logged" : "Start"}
                  </span>
                )}
                <span className="text-xs px-3 py-1 rounded-full bg-[rgba(224,64,208,0.12)] text-[#E040D0] font-semibold">
                  {activeSession.items.filter((i) => i.exercise_id !== "__section__").length} exercises
                </span>
              </div>
            </div>
            {!sessionOpen && (
              <div className="mt-4 flex items-center justify-between gap-3 rounded-2xl border border-[#E040D0]/25 bg-[linear-gradient(135deg,rgba(224,64,208,0.16),rgba(224,64,208,0.04))] px-4 py-3.5 text-sm font-semibold text-text-primary">
                <span>{viewMode === "readonly" ? "Tap to view the logged session" : sessionStartedAt ? "Session in progress · tap to continue" : "Tap to view this session"}</span>
                <svg className="h-4 w-4 flex-shrink-0 text-[#F060E0]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
              </div>
            )}
          </button>

          {sessionOpen && (
            <>
          {viewMode === "log" && (
            <div className="px-5 pb-4">
              {sessionStartedAt ? (
                <div className="flex items-center justify-between gap-3 rounded-2xl border border-[#E040D0]/30 bg-[#E040D0]/8 px-4 py-3">
                  <span className="inline-flex items-center gap-2 text-sm font-semibold text-[#F060E0]"><span className="h-2 w-2 animate-pulse rounded-full bg-[#F060E0]" />Session in progress</span>
                  <span className="metric-num text-lg font-bold text-text-primary"><ElapsedTime startedAt={sessionStartedAt} /></span>
                </div>
              ) : (
                <button type="button" onClick={() => {
                  setRunnerMode("workout");
                  setRunnerOpen(true);
                }} className="w-full rounded-xl bg-[#E040D0] px-5 py-3.5 text-sm font-semibold text-white hover:bg-[#F060E0]">
                  Open workout
                </button>
              )}
            </div>
          )}
          {/* Session header */}
          <div className="p-5 border-b border-[rgba(0,0,0,0.06)]">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold text-[#E040D0] uppercase tracking-wider mb-1">
                  {isToday(selectedDate)
                    ? "Today"
                    : selectedDate.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short" })}
                </p>
                <h2 className="text-xl font-bold text-text-primary">{activeSession.name}</h2>
                {activeSession.notes && (
                  <p className="text-sm text-text-secondary mt-1 italic">{activeSession.notes}</p>
                )}
              </div>
              <div className="flex flex-col items-end gap-2 flex-shrink-0">
                <span className="text-xs px-3 py-1 rounded-full bg-[rgba(224,64,208,0.12)] text-[#E040D0] font-semibold">
                  {activeSession.items.filter((i) => i.exercise_id !== "__section__").length} exercises
                </span>
                {/* Toggle between log and readonly for past days */}
                {isPast && viewMode === "readonly" && (
                  <button
                    onClick={() => {
                      setViewMode("log");
                      setSessionOpen(true);
                      setManuallyPicked(true);
                      initDrafts(activeSession, dayLogs.filter((log) => log.session_id === activeSession.id));
                      setRunnerMode("edit");
                      setRunnerOpen(true);
                    }}
                    className="text-xs text-text-secondary hover:text-text-primary underline cursor-pointer"
                  >
                    Edit
                  </button>
                )}
                {isPast && viewMode === "log" && dayLogs.length > 0 && (
                  <button
                    onClick={() => setViewMode("readonly")}
                    className="text-xs text-text-secondary hover:text-text-primary underline cursor-pointer"
                  >
                    View logged
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Past day — no log */}
          {isPast && dayLogs.length === 0 && viewMode === "log" && (
            <div className="px-5 pt-4">
              <div className="flex items-center gap-2 mb-4 px-3 py-2 bg-[rgba(0,0,0,0.03)] rounded-xl">
                <svg className="w-4 h-4 text-text-secondary/60 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p className="text-sm text-text-secondary">Logging retroactively for this date</p>
              </div>
            </div>
          )}

          {/* Readonly view (logged session) */}
          {viewMode === "readonly" && dayLogs.length > 0 && (
            <div className="divide-y divide-[rgba(0,0,0,0.04)]">
              {activeSession.items.map((item) => {
                if (item.exercise_id === "__section__") {
                  return (
                    <div key={item.id} className="flex items-center gap-3 px-5 pt-5 pb-2">
                      <div className="w-1 h-4 rounded-full bg-[#E040D0]" />
                      <span className="text-xs font-bold text-text-primary uppercase tracking-wider">
                        {item.section_label || "Section"}
                      </span>
                    </div>
                  );
                }
                const log = dayLogs.find((l) => l.exercise_item_id === item.id);
                return (
                  <div key={item.id} className="px-5 py-4">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-semibold text-text-primary text-sm">{log?.performed_exercise_name || item.exercise?.name || "Unknown"}</p>
                        {log?.performed_exercise_id && log.performed_exercise_id!==item.exercise_id && <p className="mt-1 text-xs text-text-secondary">Swapped for this workout · prescribed {log.prescribed_exercise_name || item.exercise?.name}</p>}
                        {item.exercise?.muscle_group && (
                          <p className="text-xs text-text-secondary mt-0.5 capitalize">{item.exercise.muscle_group}</p>
                        )}
                      </div>
                      <span className="text-xs font-bold px-2.5 py-1 rounded-lg bg-[rgba(224,64,208,0.10)] text-[#E040D0] flex-shrink-0">
                        {formatExercisePrescription(item)}
                      </span>
                    </div>
                    {(log?.sets_data?.length ?? 0) > 0 && (
                      <div className="mt-2.5 flex flex-wrap gap-2">
                        {(log?.sets_data ?? []).map((s, i) => (
                          <span
                            key={i}
                            className="text-xs px-2.5 py-1 rounded-lg bg-[rgba(0,0,0,0.04)] text-text-secondary font-medium"
                          >
                            {shouldUseSetLogging(item)
                              ? `${s.weight ? `${s.weight}kg` : "--"} x ${s.reps || "--"}`
                              : s.reps || s.notes || "--"}
                          </span>
                        ))}
                      </div>
                    )}
                    {!log && (
                      <p className="text-xs text-text-secondary/50 mt-1">Not logged</p>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Past day, no logs, no session found */}
          {isPast && dayLogs.length === 0 && viewMode === "readonly" && (
            <div className="px-5 py-10 text-center">
              <p className="text-text-secondary text-sm">No session logged for this day.</p>
              <button
              onClick={() => {
                setViewMode("log");
                setSessionOpen(true);
                initDrafts(activeSession);
                setRunnerMode("workout");
                setRunnerOpen(true);
              }}
                className="mt-3 text-sm text-[#E040D0] hover:underline font-semibold cursor-pointer"
              >
                Log a session retroactively
              </button>
            </div>
          )}

          {/* Log form (today, future, or retroactive) */}
          {false && viewMode === "log" && (
            <div className="divide-y divide-[rgba(0,0,0,0.04)]">
              {activeSession!.items.map((item) => {
                if (item.exercise_id === "__section__") {
                  return (
                    <div key={item.id} className="flex items-center gap-3 px-5 pt-5 pb-2">
                      <div className="w-1 h-4 rounded-full bg-[#E040D0]" />
                      <span className="text-xs font-bold text-text-primary uppercase tracking-wider">
                        {item.section_label || "Section"}
                      </span>
                    </div>
                  );
                }

                const sets = draftSets[item.id] || [];
                const useSetLogging = shouldUseSetLogging(item);

                return (
                  <div key={item.id} className="px-3 py-3 sm:px-5 sm:py-4">
                    <div className="app-inset rounded-[24px] p-4">
                    {/* Exercise header */}
                    <div className="flex items-start justify-between gap-3 mb-4">
                      <div>
                        <p className="font-bold text-text-primary">{item.exercise?.name || "Unknown"}</p>
                        {item.exercise?.muscle_group && (
                          <p className="text-xs text-text-secondary mt-0.5 capitalize">{item.exercise.muscle_group}</p>
                        )}
                        {item.notes && (
                          <p className="text-xs text-text-secondary/70 mt-1 italic">{item.notes}</p>
                        )}
                      </div>
                      <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                        <span className="text-xs font-bold px-2.5 py-1 rounded-lg bg-[rgba(224,64,208,0.10)] text-[#E040D0]">
                          {formatExercisePrescription(item)}
                        </span>
                        <div className="flex gap-1.5">
                          {item.rest_seconds && (
                            <span className="text-xs px-2 py-0.5 rounded-md bg-[rgba(0,0,0,0.04)] text-text-secondary font-medium">
                              {item.rest_seconds}s rest
                            </span>
                          )}
                          {item.tempo && (
                            <span className="text-xs px-2 py-0.5 rounded-md bg-[rgba(0,0,0,0.04)] text-text-secondary font-medium">
                              {item.tempo}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Demo link */}
                    {item.exercise && getExerciseDemoUrl(item.exercise.video_url, item.exercise.name) && (
                      <button
                        onClick={() => {
                          void openExerciseDemo(item.exercise?.video_url, item.exercise?.name);
                        }}
                        className="inline-flex items-center gap-1 text-xs text-[#E040D0] border border-[rgba(224,64,208,0.25)] px-2.5 py-1 rounded-lg hover:bg-[rgba(224,64,208,0.08)] transition-colors cursor-pointer mb-3"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        Demo
                      </button>
                    )}

                    {/* Sets input grid */}
                    <div className="space-y-3">
                      {useSetLogging && (
                        <div className="hidden sm:grid sm:grid-cols-[28px_1fr_1fr_1fr] gap-2 px-1">
                          <span className="text-[10px] text-text-secondary font-medium text-center">#</span>
                          <span className="text-[10px] text-text-secondary font-medium">Weight (kg)</span>
                          <span className="text-[10px] text-text-secondary font-medium">Reps</span>
                          <span className="text-[10px] text-text-secondary font-medium">Notes</span>
                        </div>
                      )}
                      {sets.map((set, setIdx) => (
                        <div key={setIdx} className="rounded-2xl border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.025)] p-3">
                          <div className={useSetLogging ? "grid grid-cols-[3.25rem_1fr_1fr] gap-2 sm:grid-cols-[28px_1fr_1fr_1fr] sm:items-center" : "grid gap-2 sm:grid-cols-[1fr_1fr]"}>
                            {useSetLogging && (
                              <div className="flex h-full min-h-[54px] flex-col items-center justify-center rounded-xl border border-[#E040D0]/20 bg-[#E040D0]/8 text-center sm:min-h-0 sm:border-0 sm:bg-transparent">
                                <span className="text-[9px] font-semibold uppercase tracking-[0.16em] text-[#E040D0] sm:hidden">Set</span>
                                <span className="text-base font-heading font-bold text-text-primary sm:text-xs sm:text-text-secondary" aria-label={`Set ${set.set_number}`}>{set.set_number}</span>
                              </div>
                            )}
                            {useSetLogging ? (
                              <>
                                <label className="block">
                                  <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.14em] text-text-muted sm:hidden">Weight</span>
                                  <div className="relative">
                                    <input
                                      type="text"
                                      inputMode="decimal"
                                      placeholder="0"
                                      aria-label={`Set ${set.set_number} weight in kg`}
                                      value={set.weight}
                                      onChange={(e) => updateSet(item.id, setIdx, "weight", e.target.value)}
                                      className="w-full rounded-xl border border-[#E040D0]/20 bg-white px-3 py-3 pr-9 text-base font-semibold text-text-primary placeholder:text-text-muted/40 shadow-inner focus:outline-none focus:border-[#E040D0]/60 sm:bg-[rgba(0,0,0,0.03)] sm:py-1.5 sm:text-sm"
                                    />
                                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-text-muted">kg</span>
                                  </div>
                                </label>
                                <label className="block">
                                  <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.14em] text-text-muted sm:hidden">Reps</span>
                                  <input
                                    type="text"
                                    inputMode="numeric"
                                    placeholder={item.reps}
                                    aria-label={`Set ${set.set_number} reps`}
                                    value={set.reps}
                                    onChange={(e) => updateSet(item.id, setIdx, "reps", e.target.value)}
                                    className="w-full rounded-xl border border-[#E040D0]/20 bg-white px-3 py-3 text-base font-semibold text-text-primary placeholder:text-text-muted/40 shadow-inner focus:outline-none focus:border-[#E040D0]/60 sm:bg-[rgba(0,0,0,0.03)] sm:py-1.5 sm:text-sm"
                                  />
                                </label>
                              </>
                            ) : (
                              <label className="block">
                                <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.14em] text-text-muted">Result</span>
                                <input
                                  type="text"
                                  placeholder={formatExercisePrescription(item)}
                                  aria-label={`${item.exercise?.name || "Exercise"} result`}
                                  value={set.reps}
                                  onChange={(e) => updateSet(item.id, setIdx, "reps", e.target.value)}
                                  className="w-full rounded-xl border border-[#E040D0]/20 bg-white px-3 py-3 text-base font-semibold text-text-primary placeholder:text-text-muted/40 shadow-inner focus:outline-none focus:border-[#E040D0]/60 sm:bg-[rgba(0,0,0,0.03)] sm:py-2 sm:text-sm"
                                />
                              </label>
                            )}
                            <label className={useSetLogging ? "col-span-3 block sm:col-span-1" : "block"}>
                              <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.14em] text-text-muted sm:hidden">Notes</span>
                              <input
                                type="text"
                                placeholder="Optional note"
                                aria-label={`Set ${set.set_number} note`}
                                value={set.notes}
                                onChange={(e) => updateSet(item.id, setIdx, "notes", e.target.value)}
                                className="w-full rounded-xl border border-[rgba(0,0,0,0.08)] bg-white px-3 py-3 text-sm text-text-primary placeholder:text-text-muted/50 shadow-inner focus:outline-none focus:border-[#E040D0]/50 sm:bg-[rgba(0,0,0,0.03)] sm:py-1.5"
                              />
                            </label>
                          </div>
                          {useSetLogging && setIdx >= Math.max(1, Number(item.sets) || 3) && (
                            <button type="button" onClick={() => removeSet(item.id, setIdx)}
                              aria-label={`Remove extra set ${set.set_number}`}
                              className="mt-2 min-h-11 px-2 text-xs font-semibold text-red-500 cursor-pointer">
                              Remove extra set
                            </button>
                          )}
                        </div>
                      ))}
                    </div>

                    {useSetLogging && (
                      <button
                        onClick={() => addSet(item.id)}
                        className="mt-3 rounded-xl border border-[#E040D0]/20 bg-[#E040D0]/8 px-3 py-2 text-xs font-semibold text-[#E040D0] transition-colors hover:bg-[#E040D0]/12 cursor-pointer"
                      >
                        + Add set
                      </button>
                    )}
                    </div>
                  </div>
                );
              })}

              {/* Save button — inline on desktop, extra space on mobile so sticky bar has room */}
              <div className="p-5 pb-2 sm:pb-5">
                {saveError && (
                  <p className="mb-3 rounded-xl border border-red-500/15 bg-red-500/8 px-4 py-3 text-sm text-red-400">
                    {saveError}
                  </p>
                )}
                <button
                  onClick={saveSession}
                  disabled={saving}
                  className="hidden w-full rounded-xl bg-[#E040D0] py-3 text-sm font-semibold text-white shadow-none ring-0 transition-colors hover:bg-[#F060E0] disabled:opacity-60 sm:block"
                >
                  <CyclingStatusText active={saving} idle="Save Session" messages={["Saving...", "Logging sets...", "Updating week...", "Nearly there..."]} />
                </button>
              </div>
            </div>
          )}
            </>
          )}
        </div>
      )}

      {/* Session picker is portalled above the app shell so the mobile nav can never cover it. */}
      {showSessionPicker && plan && typeof document !== "undefined" && createPortal((
        <div
          className="fixed inset-0 z-[1000] flex h-[100dvh] items-end justify-center bg-black/65 px-2 pt-[max(1rem,env(safe-area-inset-top))] backdrop-blur-sm sm:items-center sm:p-4"
          onClick={() => setShowSessionPicker(false)}
        >
          <div
            className="flex max-h-[calc(100dvh-max(1rem,env(safe-area-inset-top))-0.5rem)] min-h-0 w-full flex-col overflow-hidden rounded-t-[28px] border border-white/[0.10] bg-[#111114] pb-[max(1rem,env(safe-area-inset-bottom))] shadow-2xl sm:max-h-[80vh] sm:max-w-md sm:rounded-[28px] sm:pb-4"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="session-picker-title"
          >
            <div className="flex shrink-0 items-start justify-between gap-4 border-b border-white/[0.08] p-4">
              <div className="min-w-0">
                <h3 id="session-picker-title" className="text-lg font-bold text-white">Choose a workout{plan.programme_weeks ? ` · Week ${programmeWeek(plan, formatDate(selectedDate))}` : ""}</h3>
                <p className="mt-1 text-xs leading-5 text-white/55">
                  Pick the session you want to do {isToday(selectedDate) ? "today" : "on this date"}. Choosing it opens the workout; it does not change your weekly schedule.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowSessionPicker(false)}
                className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-white/[0.10] bg-white/[0.05] text-white/70"
                aria-label="Close session picker"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3">
              <div className="space-y-2">
                {weekSessions.map((s) => {
                  const isActive = s.id === activeSession?.id;
                  const exerciseCount = s.items.filter((i) => i.exercise_id !== "__section__").length;
                  const hasSavedLog = dayLogs.some((log) => log.session_id === s.id);
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => pickSession(s)}
                      className={`flex min-h-[68px] w-full items-center gap-3 rounded-2xl border p-3.5 text-left transition-all active:scale-[0.99] ${
                        isActive
                          ? "border-[#E040D0]/55 bg-[#E040D0]/10"
                          : "border-white/[0.08] bg-white/[0.035]"
                      }`}
                    >
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#E040D0]/12 text-sm font-bold text-[#F060E0]">
                        {s.day_number}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-white">{s.name}</p>
                        <p className="mt-0.5 text-xs text-white/45">
                          {exerciseCount} exercises{hasSavedLog ? " · already logged" : ""}
                        </p>
                      </div>
                      <span className="shrink-0 rounded-xl bg-[#E040D0] px-3 py-2 text-xs font-bold text-white">
                        {hasSavedLog ? "Edit" : "Choose"}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      ), document.body)}

      {/* Mobile sticky save — stays above bottom nav + respects iPhone home indicator */}
      {false && viewMode === "log" && activeSession && sessionOpen && (
        <div className="fixed bottom-[calc(5.75rem+env(safe-area-inset-bottom,0px))] left-0 right-0 z-30 bg-bg-primary/95 px-4 py-3 backdrop-blur sm:hidden">
          <button
            onClick={saveSession}
            disabled={saving}
            className="min-h-[48px] w-full rounded-2xl bg-[#E040D0] py-3.5 text-sm font-semibold text-white shadow-none ring-0 transition-colors hover:bg-[#F060E0] disabled:opacity-60"
          >
            <CyclingStatusText active={saving} idle="Save Session" messages={["Saving...", "Logging sets...", "Updating week...", "Nearly there..."]} />
          </button>
        </div>
      )}

      {runnerOpen && activeSession && (!alternativesLoaded || !previousLoadsReady) && <p role="status" className="fixed inset-0 z-[100] grid place-items-center bg-[#09090b] text-white">Loading your workout…</p>}
      {runnerOpen && activeSession && alternativesLoaded && previousLoadsReady && typeof document !== "undefined" && createPortal((
        <NativeWorkoutLauncher
          key={`native:${activeSession.id}:${selectedDateStr}:${runnerMode}`}
          session={runnerSession!}
          forceWeb={activeSession.items.some(item => Boolean(alternatives[item.id]?.length) || Boolean(performedExercises[item.id] && performedExercises[item.id].id !== item.exercise_id))}
          mode={runnerMode}
          date={selectedDateStr}
          dateLabel={isToday(selectedDate)
            ? "Today"
            : selectedDate.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short" })}
          sets={draftSets}
          startedAt={sessionStartedAt}
          onClose={() => setRunnerOpen(false)}
          fallback={(
            <AtCapacityWorkoutRunner
              session={runnerSession!}
              originalSession={activeSession}
              alternatives={alternatives}
              previousLoads={previousLoads.key === previousLoadsKey ? previousLoads.data : {}}
              previousLoadsError={previousLoads.key === previousLoadsKey ? previousLoads.error : null}
              savedItemIds={dayLogs.map(log=>log.exercise_item_id)}
              onSwap={swapExercise}
              mode={runnerMode}
              dateLabel={isToday(selectedDate)
                ? "Today"
                : selectedDate.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short" })}
              sets={draftSets}
              startedAt={sessionStartedAt}
              saving={saving}
              saveError={saveError}
              onClose={() => setRunnerOpen(false)}
              onStart={() => startSessionTimer(activeSession)}
              onUpdateSet={updateSet}
              onToggleSet={toggleSet}
              onAddSet={addSet}
              onRemoveSet={removeSet}
              onApplyFirstSetToAll={applyFirstSetToAll}
              onFinish={saveSession}
            />
          )}
        />
      ), document.body)}
    </div>
  );
}
