"use client";

import * as React from "react";
import { fetchHistoryStatuses } from "@/lib/history/client";
import { jitterPollDelay } from "@/lib/history/status";

function isInProgress(status: string) {
  const value = (status || "").toLowerCase();
  return value === "running" || value === "queued" || value === "pending" || value === "submitted" || value === "processing";
}

export function useGenerationRunning({
  userId,
  type,
  pollMs = 1500,
  enabled = true,
}: {
  userId: string;
  type: string;
  pollMs?: number;
  enabled?: boolean;
}) {
  const key = React.useMemo(() => {
    if (!userId || !type) return "";
    return `studio_running_v1_${userId}_${type}`;
  }, [type, userId]);
  const globalKey = React.useMemo(() => {
    if (!type) return "";
    return `studio_running_v1_${type}_global`;
  }, [type]);

  const [running, setRunning] = React.useState(false);

  React.useEffect(() => {
    if (!key) return;
    try {
      if (localStorage.getItem(key) === "1") setRunning(true);
    } catch {}
  }, [key]);

  React.useEffect(() => {
    if (!globalKey) return;
    try {
      if (localStorage.getItem(globalKey) === "1") setRunning(true);
    } catch {}
  }, [globalKey]);

  const refresh = React.useCallback(async () => {
    if (!enabled || !userId || !type) return false;
    const items = await fetchHistoryStatuses({ type, source: "tool" });
    const anyRunning = items.some((item) => isInProgress(String(item.status || "")));
    setRunning((previous) => (anyRunning === previous ? previous : anyRunning));
    if (key) {
      try {
        if (anyRunning) {
          localStorage.setItem(key, "1");
          if (globalKey) localStorage.setItem(globalKey, "1");
        } else {
          localStorage.removeItem(key);
          if (globalKey) localStorage.removeItem(globalKey);
        }
      } catch {}
    }
    return anyRunning;
  }, [enabled, globalKey, key, type, userId]);

  React.useEffect(() => {
    if (!enabled || !userId || !type) return;
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
      timer = window.setTimeout(() => void safeRefresh(), jitterPollDelay(pollMs));
    };

    const safeRefresh = async () => {
      if (disposed || document.visibilityState === "hidden" || inFlight) return;
      inFlight = true;
      try {
        await refresh();
      } catch {
        // Keep the cached running state when a transient status request fails.
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
      void safeRefresh();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    void safeRefresh();
    return () => {
      disposed = true;
      clearTimer();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [enabled, pollMs, refresh, type, userId]);

  return { running, refresh };
}
