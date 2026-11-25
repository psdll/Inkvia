"use client";
import { UiText, UiProps, useUiLocale } from "@/i18n/ui";


import * as React from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { ChevronDown, Loader2, ListChecks, X } from "lucide-react";
import { FrostedSelect } from "@/components/ui/frosted-select";
import type { UnifiedHistoryPanelHandle } from "@/components/history/unified-history-panel";
import { friendlyErrorPrimaryText } from "@/lib/error-friendly";
import { jitterPollDelay } from "@/lib/history/status";
import { isKnownDeletedGenerationId, subscribeGenerationDeleted } from "@/lib/generation-deletion-events";

type GenerationTask = {
  id: number;
  type: string;
  status: string;
  localPath: string | null;
  externalTaskId?: string | null;
  errorMsg?: string | null;
  createdAt: string;
  finishedAt?: string | null;
};

function typeLabel(t: string, text: ReturnType<typeof useUiLocale>["text"]) {
  if (t === "face_swap") return text("createDynamic.m5235f7494aaa");
  if (t === "image_edit") return text("createDynamic.md24c10d37db0");
  if (t === "video_gen" || t === "video_generate") return text("createDynamic.mc20f7618d330");
  return t || text("createDynamic.m4d8c1c5b4283");
}

function statusLabel(s: string, text: ReturnType<typeof useUiLocale>["text"]) {
  const v = (s || "").toLowerCase();
  if (v === "running") return text("createDynamic.m5026a63b58cd");
  if (v === "processing") return text("createDynamic.m694b71bc8013");
  if (v === "submitted") return text("createDynamic.mbc37a6110a07");
  if (v === "queued" || v === "pending") return text("createDynamic.md6f766f2adf5");
  if (v === "success") return text("createDynamic.mf28461bb49c8");
  if (v === "failed") return text("createDynamic.m28384d7afd2e");
  if (v === "cancelled") return text("createDynamic.ma37778f17c5f");
  return s || text("createDynamic.m4d8c1c5b4283");
}

function statusTone(s: string) {
  const v = (s || "").toLowerCase();
  if (v === "success") return "text-emerald-600";
  if (v === "failed") return "text-rose-600";
  if (v === "running" || v === "processing" || v === "submitted") return "text-blue-600";
  if (v === "queued" || v === "pending") return "text-amber-600";
  return "text-[var(--app-muted)]";
}

function getRangeCutoff(timeRange: TimeRangeFilter) {
  if (timeRange === "all") return 0;
  const now = new Date();
  if (timeRange === "1d") {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  }
  const days = timeRange === "7d" ? 7 : 15;
  return Date.now() - days * 24 * 60 * 60 * 1000;
}

function isInProgress(s: string) {
  const v = (s || "").toLowerCase();
  return v === "running" || v === "queued" || v === "pending" || v === "submitted" || v === "processing";
}

function isCompleted(s: string) {
  const v = (s || "").toLowerCase();
  return v === "success" || v === "failed" || v === "cancelled";
}

function taskGroupKey(t: GenerationTask) {
  const externalTaskId = String(t.externalTaskId || "").trim();
  return externalTaskId ? `${t.type}:${externalTaskId}` : `${t.type}:local:${t.id}`;
}

function taskTimeMs(value: string | null | undefined) {
  const ms = value ? new Date(value).getTime() : 0;
  return Number.isFinite(ms) ? ms : 0;
}

function pickTaskRepresentative(current: GenerationTask, next: GenerationTask) {
  const currentCreated = taskTimeMs(current.createdAt);
  const nextCreated = taskTimeMs(next.createdAt);
  if (nextCreated && (!currentCreated || nextCreated < currentCreated)) return next;
  if (nextCreated === currentCreated && next.id < current.id) return next;
  return current;
}

function compactTaskGroups(list: GenerationTask[]) {
  const byGroup = new Map<string, GenerationTask>();
  for (const task of list) {
    const key = taskGroupKey(task);
    const existing = byGroup.get(key);
    byGroup.set(key, existing ? pickTaskRepresentative(existing, task) : task);
  }
  return Array.from(byGroup.values()).sort((a, b) => {
    const at = taskTimeMs(a.createdAt);
    const bt = taskTimeMs(b.createdAt);
    return bt - at || b.id - a.id;
  });
}

type TimeRangeFilter = "all" | "1d" | "7d" | "15d";
type TypeFilter = "all" | "face_swap" | "image_edit" | "video";

const TIME_RANGE_OPTIONS = [
  { value: "all", message: "createDynamic.mb28e2113fe3a" },
  { value: "1d", message: "createDynamic.md5f5a7a01073" },
  { value: "7d", message: "createDynamic.mfc7b29c29f1e" },
  { value: "15d", message: "createDynamic.m29aaed012645" },
];

const TYPE_FILTER_OPTIONS = [
  { value: "all", message: "createDynamic.m267c4a7a86dd" },
  { value: "face_swap", message: "createDynamic.m5235f7494aaa" },
  { value: "image_edit", message: "createDynamic.md24c10d37db0" },
  { value: "video", message: "createDynamic.mc20f7618d330" },
];
type TaskCacheEntry = {
  tasks: GenerationTask[];
  fetchedAt: number;
};

function formatDuration(ms: number) {
  const safe = Math.max(0, Math.floor(ms));
  const totalSeconds = Math.floor(safe / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  const tenths = Math.floor((safe % 1000) / 100);
  return `${seconds}.${tenths}s`;
}

const HISTORY_ACTIONS_POLL_MS = 4000;
const HISTORY_SUMMARY_POLL_MS = 15_000;
const HISTORY_SUMMARY_VISIBILITY_RESUME_DELAY_MS = 280;
const TASK_CACHE_TTL_MS = 30 * 1000;
const taskCache = new Map<string, TaskCacheEntry>();

function getTaskCacheKey(userId: string, timeRange: TimeRangeFilter, typeFilter: TypeFilter, hiddenBeforeMs: number) {
  return `${userId}|${timeRange}|${typeFilter}|${hiddenBeforeMs || 0}`;
}

function getTaskStorageKey(cacheKey: string) {
  return `studio_task_cache_v2_${cacheKey}`;
}

function readStoredTaskCache(cacheKey: string): TaskCacheEntry | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(getTaskStorageKey(cacheKey));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<TaskCacheEntry> | null;
    if (!parsed || !Array.isArray(parsed.tasks)) return null;
    return {
      tasks: parsed.tasks as GenerationTask[],
      fetchedAt: Number(parsed.fetchedAt) || 0,
    };
  } catch {
    return null;
  }
}

function writeStoredTaskCache(cacheKey: string, entry: TaskCacheEntry) {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(getTaskStorageKey(cacheKey), JSON.stringify(entry));
  } catch {}
}

export function UnifiedHistoryActions({
  historyRef,
  historyCount,
  userId: userIdProp,
  onFocusHistoryId,
  variant = "default",
  className,
}: {
  historyRef: React.RefObject<UnifiedHistoryPanelHandle>;
  historyCount: number;
  userId?: string;
  onFocusHistoryId: (id: string) => void;
  variant?: "default" | "compact";
  className?: string;
}) {
  const { user } = useAuth();
  const { error: localizeError, text, locale } = useUiLocale();
  const [userId, setUserId] = React.useState(userIdProp || "");
  const [open, setOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [tasks, setTasks] = React.useState<GenerationTask[]>([]);
  const [inProgressCount, setInProgressCount] = React.useState(0);
  const [now, setNow] = React.useState(() => Date.now());
  const [hiddenTaskIds, setHiddenTaskIds] = React.useState<Set<number>>(new Set());
  const [hiddenBeforeMs, setHiddenBeforeMs] = React.useState<number>(0);
  const [timeRange, setTimeRange] = React.useState<TimeRangeFilter>("1d");
  const [typeFilter, setTypeFilter] = React.useState<TypeFilter>("all");
  const summaryInFlightRef = React.useRef(false);
  const taskProgressRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => subscribeGenerationDeleted((ids) => {
    if (!userId) return;
    const deleted = new Set(ids);
    setTasks((current) => current.filter((task) => !deleted.has(Number(task.id))));
    const cachePrefix = `${userId}|`;
    for (const [key, entry] of Array.from(taskCache.entries())) {
      if (!key.startsWith(cachePrefix)) continue;
      const next = { ...entry, tasks: entry.tasks.filter((task) => !deleted.has(Number(task.id))) };
      taskCache.set(key, next);
      writeStoredTaskCache(key, next);
    }
    try {
      const storagePrefix = `studio_task_cache_v2_${cachePrefix}`;
      for (let index = sessionStorage.length - 1; index >= 0; index -= 1) {
        const key = sessionStorage.key(index);
        if (!key?.startsWith(storagePrefix)) continue;
        const raw = sessionStorage.getItem(key);
        const parsed = raw ? JSON.parse(raw) as TaskCacheEntry : null;
        if (!parsed?.tasks) continue;
        sessionStorage.setItem(key, JSON.stringify({
          ...parsed,
          tasks: parsed.tasks.filter((task) => !deleted.has(Number(task.id))),
        }));
      }
    } catch {}
  }), [userId]);

  React.useEffect(() => {
    if (userIdProp) setUserId(userIdProp);
  }, [userIdProp]);

  React.useEffect(() => {
    if (userId) return;
    setUserId(user?.id ? String(user.id) : "");
  }, [user?.id, userId]);

  React.useEffect(() => {
    if (userId) return;
    setTasks([]);
    setInProgressCount(0);
  }, [userId]);

  React.useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (taskProgressRef.current?.contains(target)) return;
      setOpen(false);
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  const loadSummary = React.useCallback(async () => {
    if (!userId) return;
    if (summaryInFlightRef.current) return;
    summaryInFlightRef.current = true;
    try {
      const url = new URL("/api/history/summary", window.location.origin);
      url.searchParams.set("userId", userId);
      const res = await fetch(url.toString(), { cache: "no-store" });
      const json = (await res.json().catch(() => null)) as any;
      if (!res.ok) return;
      const c = Math.max(0, Number(json?.inProgressCount || 0) || 0);
      setInProgressCount((prev) => (c === prev ? prev : c));
    } finally {
      summaryInFlightRef.current = false;
    }
  }, [userId]);

  React.useEffect(() => {
    if (!userId) return;
    try {
      const raw = localStorage.getItem(`studio_task_hidden_v1_${userId}`);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;
      const set = new Set<number>();
      for (const v of parsed) {
        const n = Number(v);
        if (Number.isFinite(n)) set.add(n);
      }
      setHiddenTaskIds(set);
    } catch {}
  }, [userId]);

  React.useEffect(() => {
    if (!userId) return;
    try {
      const raw = localStorage.getItem(`studio_task_hidden_before_v1_${userId}`);
      const n = raw ? Number(raw) : 0;
      if (Number.isFinite(n) && n > 0) setHiddenBeforeMs(n);
    } catch {}
  }, [userId]);

  const persistTimeRange = React.useCallback(
    (next: TimeRangeFilter) => {
      setTimeRange(next);
      if (!userId) return;
      try {
        window.dispatchEvent(new CustomEvent("studio:task-filters", { detail: { userId, timeRange: next } }));
      } catch {}
    },
    [userId]
  );

  const persistTypeFilter = React.useCallback(
    (next: TypeFilter) => {
      setTypeFilter(next);
      if (!userId) return;
      try {
        window.dispatchEvent(new CustomEvent("studio:task-filters", { detail: { userId, typeFilter: next } }));
      } catch {}
    },
    [userId]
  );

  const persistHiddenTaskIds = React.useCallback(
    (next: Set<number>) => {
      if (!userId) return;
      setHiddenTaskIds(next);
      try {
        localStorage.setItem(`studio_task_hidden_v1_${userId}`, JSON.stringify(Array.from(next.values())));
      } catch {}
    },
    [userId]
  );

  const persistHiddenBeforeMs = React.useCallback(
    (ms: number) => {
      if (!userId) return;
      setHiddenBeforeMs(ms);
      try {
        localStorage.setItem(`studio_task_hidden_before_v1_${userId}`, String(ms));
      } catch {}
    },
    [userId]
  );

  const load = React.useCallback(async () => {
    if (!userId) return;
    const cacheKey = getTaskCacheKey(userId, timeRange, typeFilter, hiddenBeforeMs);
    const rawCached = taskCache.get(cacheKey) || readStoredTaskCache(cacheKey);
    const cached = rawCached ? {
      ...rawCached,
      tasks: rawCached.tasks.filter((task) => !isKnownDeletedGenerationId(task.id)),
    } : null;
    if (cached) {
      taskCache.set(cacheKey, cached);
      setTasks(cached.tasks);
      const cacheIsFresh = Date.now() - cached.fetchedAt < TASK_CACHE_TTL_MS;
      if (cacheIsFresh) return;
    }
    setLoading(!cached && tasks.length === 0);
    try {
      const url = new URL("/api/history", window.location.origin);
      url.searchParams.set("userId", userId);
      url.searchParams.set("status", "all");
      url.searchParams.set("withOutput", "0");
      url.searchParams.set("take", "200");
      url.searchParams.set("skip", "0");
      const res = await fetch(url.toString(), { cache: "no-store" });
      if (!res.ok) return;
      const json = (await res.json().catch(() => null)) as any;
      const raw = Array.isArray(json?.items) ? (json.items as GenerationTask[]) : [];
      const cutoff = hiddenBeforeMs || 0;
      const rangeCutoff = getRangeCutoff(timeRange);
      const nextTasks = raw
          .filter((x) => x && String(x.type || "") !== "import")
          .filter((x) => !isKnownDeletedGenerationId(x.id))
          .map((x) => ({
            id: Number(x.id),
            type: String(x.type || ""),
            status: String(x.status || ""),
            localPath: x.localPath ? String(x.localPath) : null,
            externalTaskId: (x as any).externalTaskId ? String((x as any).externalTaskId) : null,
            errorMsg: x.errorMsg ? String(x.errorMsg) : null,
            createdAt: String(x.createdAt || ""),
            finishedAt: (x as any).finishedAt ? String((x as any).finishedAt) : null
          }))
          .filter((x) => {
            if (!rangeCutoff) return true;
            const keyTime = new Date(String(x.finishedAt || x.createdAt || "")).getTime();
            if (!keyTime) return false;
            return keyTime >= rangeCutoff;
          })
          .filter((x) => {
            if (typeFilter === "all") return true;
            if (typeFilter === "video") return x.type === "video_gen" || x.type === "video_generate";
            return x.type === typeFilter;
          })
          .filter((x) => {
            if (!cutoff) return true;
            const t = x.createdAt ? new Date(x.createdAt).getTime() : 0;
            if (!t) return true;
            return t >= cutoff;
          });
      setTasks(nextTasks);
      const entry = { tasks: nextTasks, fetchedAt: Date.now() };
      taskCache.set(cacheKey, entry);
      writeStoredTaskCache(cacheKey, entry);
    } finally {
      setLoading(false);
    }
  }, [hiddenBeforeMs, tasks.length, timeRange, typeFilter, userId]);

  React.useEffect(() => {
    if (!open) return;
    let inFlight = false;
    const run = async () => {
      if (document.visibilityState === "hidden" || inFlight) return;
      inFlight = true;
      try {
        await load();
      } finally {
        inFlight = false;
      }
    };
    void run();
    const t = window.setInterval(() => void run(), HISTORY_ACTIONS_POLL_MS);
    return () => window.clearInterval(t);
  }, [load, open]);

  React.useEffect(() => {
    if (!open) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [open]);

  React.useEffect(() => {
    if (!userId) return;
    let disposed = false;
    let inFlight = false;
    let timer: number | null = null;

    const clearTimer = () => {
      if (timer == null) return;
      window.clearTimeout(timer);
      timer = null;
    };

    const schedule = () => {
      clearTimer();
      if (disposed || document.visibilityState === "hidden") return;
      timer = window.setTimeout(() => void run(), jitterPollDelay(HISTORY_SUMMARY_POLL_MS));
    };

    const run = async () => {
      if (disposed || document.visibilityState === "hidden" || inFlight) return;
      inFlight = true;
      try {
        await loadSummary();
      } finally {
        inFlight = false;
        schedule();
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        clearTimer();
        return;
      }
      clearTimer();
      timer = window.setTimeout(() => void run(), HISTORY_SUMMARY_VISIBILITY_RESUME_DELAY_MS);
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    void run();
    return () => {
      disposed = true;
      clearTimer();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [loadSummary, userId]);

  const clearQueue = React.useCallback(async () => {
    if (!userId) return;
    const res = await fetch("/api/history/cleanup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, action: "clear_queue" })
    });
    await res.json().catch(() => null);
    await Promise.allSettled([loadSummary(), load()]);
  }, [load, loadSummary, userId]);

  const clearCompleted = React.useCallback(async () => {
    if (!userId) return;
    persistHiddenBeforeMs(Date.now());
    const next = new Set(hiddenTaskIds);
    for (const t of tasks) {
      if (!t || !Number.isFinite(t.id)) continue;
      if (isCompleted(t.status)) next.add(t.id);
    }
    persistHiddenTaskIds(next);
  }, [hiddenTaskIds, persistHiddenBeforeMs, persistHiddenTaskIds, tasks, userId]);

  const taskName = (t: GenerationTask) => text("createDynamic.m14a921417ffe", { type: typeLabel(t.type, text) });

  const elapsedText = (t: GenerationTask) => {
    const start = t.createdAt ? new Date(t.createdAt).getTime() : 0;
    const endRaw = t.finishedAt ? new Date(t.finishedAt).getTime() : null;
    const end = endRaw ?? now;
    if (!start) return "--";
    if (endRaw == null && !isInProgress(t.status)) return "--";
    return formatDuration(end - start);
  };

  const visibleTasks = React.useMemo(() => {
    const cutoff = hiddenBeforeMs || 0;
    return compactTaskGroups(tasks.filter((t) => {
      if (hiddenTaskIds.has(t.id)) return false;
      if (!cutoff) return true;
      const tt = t.createdAt ? new Date(t.createdAt).getTime() : 0;
      if (!tt) return true;
      return tt >= cutoff;
    }));
  }, [hiddenBeforeMs, hiddenTaskIds, tasks]);
  const visibleCompletedCount = React.useMemo(() => visibleTasks.filter((t) => isCompleted(t.status)).length, [visibleTasks]);

  const buttonClassName =
    variant === "compact"
      ? "h-7 w-[120px] rounded-xl outline-none border border-[var(--border)] bg-[var(--input-bg)] px-2.5 text-[11px] shadow-[var(--shadow-2)] hover:bg-[var(--panel-2)] focus:ring-2 focus:ring-[color-mix(in_srgb,var(--primary-bg)_24%,transparent)] transition-colors disabled:opacity-50 disabled:pointer-events-none flex items-center gap-1"
      : "h-9 rounded-xl border border-[var(--border)] bg-[var(--input-bg)] px-3 text-[13px] shadow-[var(--shadow-2)] hover:bg-[var(--panel-2)] focus:ring-2 focus:ring-[color-mix(in_srgb,var(--primary-bg)_24%,transparent)] transition-colors disabled:opacity-50 disabled:pointer-events-none flex items-center gap-2";

  const iconClassName = variant === "compact" ? "h-3 w-3" : "h-4 w-4";
  const isCompact = variant === "compact";

  return (
    <div className={["flex items-center gap-1.5", className || ""].join(" ")}>
      <div ref={taskProgressRef} className="relative">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className={[buttonClassName, "text-[var(--app-fg)]"].join(" ")}
        >
          <ListChecks className={iconClassName} />
          <span className="flex flex-1 items-center gap-2">
            <span><UiText id="common.mb341b84a7388" /></span>
            {inProgressCount > 0 ? <span className="h-2 w-2 rounded-full bg-amber-400 transition-opacity duration-1000" /> : null}
          </span>
          <ChevronDown className={[iconClassName, "transition-transform", open ? "rotate-180" : ""].join(" ")} />
        </button>

        {open ? (
          <div
            className={[
              "select-dropdown-panel task-progress-popover absolute right-0 top-full overflow-hidden z-50 rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] shadow-[var(--shadow)]",
              isCompact ? "mt-1.5 w-[300px]" : "mt-2 w-[360px]",
            ].join(" ")}
          >
            <div className={["flex items-center justify-between border-b border-[var(--border)]", isCompact ? "h-10 px-2.5" : "h-11 px-3"].join(" ")}>
              <div className={[isCompact ? "text-xs" : "text-sm", "font-semibold text-[var(--app-fg)] flex items-center gap-2"].join(" ")}>
                <span><UiText id="common.mc5ced4b36c07" /></span>
                <span
                  className={[
                    "rounded-full border border-[var(--border)] bg-[var(--panel-2)] text-[var(--app-muted)] flex items-center",
                    isCompact ? "h-5 px-1.5 text-[10px]" : "h-6 px-2 text-[11px]",
                  ].join(" ")}
                ><UiText id="common.md097506c04c2" />{visibleCompletedCount}
                </span>
                {loading ? <Loader2 className={[isCompact ? "h-3 w-3" : "h-4 w-4", "animate-spin text-[var(--app-muted)]"].join(" ")} /> : null}
              </div>
              <UiProps ids={{"aria-label":["common.m3fd47edce45b"]}}><button
                type="button"
                onClick={() => setOpen(false)}
                className={[
                  "hover:bg-[var(--panel-2)] text-[var(--app-muted)] hover:text-[var(--app-fg)] transition flex items-center justify-center",
                  isCompact ? "h-7 w-7 rounded-lg" : "h-8 w-8 rounded-xl",
                ].join(" ")}
                aria-label="common.m3fd47edce45b"
              >
                <X className={isCompact ? "h-3.5 w-3.5" : "h-4 w-4"} />
              </button></UiProps>
            </div>
            <div className={["border-b border-[var(--border)]", isCompact ? "p-1.5" : "p-2"].join(" ")}>
              <div className={["grid grid-cols-2", isCompact ? "gap-1.5" : "gap-2"].join(" ")}>
                <button
                  type="button"
                  onClick={() => void clearQueue()}
                  disabled={inProgressCount === 0}
                  className={[
                    "border border-[var(--border)] bg-[var(--panel-2)] text-[var(--app-fg)] hover:bg-[var(--panel-3)] transition disabled:opacity-50 disabled:pointer-events-none",
                    isCompact ? "h-8 rounded-xl text-[11px]" : "h-9 rounded-2xl text-[13px]",
                  ].join(" ")}
                ><UiText id="common.m21498772f98b" />{inProgressCount > 0 ? `(${inProgressCount})` : ""}
                </button>
                <button
                  type="button"
                  onClick={() => void clearCompleted()}
                  disabled={visibleCompletedCount === 0}
                  className={[
                    "border border-[var(--border)] bg-[var(--panel-2)] text-[var(--app-fg)] hover:bg-[var(--panel-3)] transition disabled:opacity-50 disabled:pointer-events-none",
                    isCompact ? "h-8 rounded-xl text-[11px]" : "h-9 rounded-2xl text-[13px]",
                  ].join(" ")}
                ><UiText id="common.m0dc2e9cd0aa4" /></button>
              </div>
            </div>
            <div className={["overflow-y-auto", isCompact ? "max-h-[240px] p-1.5" : "max-h-[300px] p-2"].join(" ")}>
              {visibleTasks.length ? (
                <div className={isCompact ? "space-y-1.5" : "space-y-2"}>
                  {visibleTasks.map((t) => {
                    return (
                      <div
                        key={t.id}
                        className={[
                          "task-progress-item border border-[var(--border)] bg-[var(--panel-bg)] flex items-center gap-2",
                          isCompact ? "rounded-xl p-2" : "rounded-2xl p-2.5",
                        ].join(" ")}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span
                              className={[
                                "rounded-full border border-[var(--border)] bg-[var(--panel-2)] text-[var(--app-fg)] flex items-center",
                                isCompact ? "text-[10px] h-5 px-1.5" : "text-xs h-6 px-2",
                              ].join(" ")}
                            >
                              {typeLabel(t.type, text)}
                            </span>
                            <span className={[isCompact ? "text-[11px]" : "text-sm", "font-medium", statusTone(t.status)].join(" ")}>
                              {statusLabel(t.status, text)}
                            </span>
                            <span className={["ml-auto text-[var(--app-muted)]", isCompact ? "text-[10px]" : "text-xs"].join(" ")}>
                              {t.createdAt ? new Date(t.createdAt).toLocaleString(locale === "en" ? "en" : undefined) : ""}
                            </span>
                          </div>
                          <div className={["mt-1 flex items-center gap-2 text-[var(--app-muted)]", isCompact ? "text-[10px]" : "text-[11px]"].join(" ")}>
                            <span className="truncate">{taskName(t)}</span>
                            <span className="ml-auto text-amber-600"><UiText id="common.m6ecedc16a644" />{elapsedText(t)}</span>
                          </div>
                          {(t.status || "").toLowerCase() === "failed" && t.errorMsg ? (
                            <div className={["text-rose-600 mt-1 truncate", isCompact ? "text-[10px]" : "text-[11px]"].join(" ")} title={localizeError(friendlyErrorPrimaryText(t.errorMsg))}>
                              {localizeError(friendlyErrorPrimaryText(t.errorMsg))}
                            </div>
                          ) : null}
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            onFocusHistoryId(String(t.id));
                            setOpen(false);
                          }}
                          className={[
                            "border border-[var(--border)] bg-[var(--panel-2)] text-[var(--app-fg)] hover:bg-[var(--panel-3)] transition disabled:opacity-40 disabled:pointer-events-none",
                            isCompact ? "h-7 px-2 rounded-lg text-[11px]" : "h-8 px-3 rounded-xl text-[13px]",
                          ].join(" ")}
                        ><UiText id="common.mdb8db0530432" /></button>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className={["text-center text-[var(--app-muted)]", isCompact ? "py-8 text-xs" : "py-10 text-sm"].join(" ")}><UiText id="common.me393f849bfa1" /></div>
              )}
            </div>
          </div>
        ) : null}
      </div>
      <FrostedSelect
        value={timeRange}
        onChange={(value) => persistTimeRange(value as TimeRangeFilter)}
        options={TIME_RANGE_OPTIONS.map(({ value, message }) => ({ value, label: text(message) }))}
        showLeading={false}
        side="auto"
        compact={isCompact}
        className={isCompact ? "w-[120px]" : "w-[126px]"}
        buttonClassName={isCompact ? "h-7 rounded-xl px-2.5 text-[11px]" : "h-9 rounded-xl px-3 text-[13px]"}
      />
      <FrostedSelect
        value={typeFilter}
        onChange={(value) => persistTypeFilter(value as TypeFilter)}
        options={TYPE_FILTER_OPTIONS.map(({ value, message }) => ({ value, label: text(message) }))}
        showLeading={false}
        side="auto"
        compact={isCompact}
        className={isCompact ? "w-[120px]" : "w-[126px]"}
        buttonClassName={isCompact ? "h-7 rounded-xl px-2.5 text-[11px]" : "h-9 rounded-xl px-3 text-[13px]"}
      />
    </div>
  );
}
