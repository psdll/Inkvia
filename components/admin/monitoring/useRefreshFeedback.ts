"use client";

import * as React from "react";

const MINIMUM_REFRESH_FEEDBACK_MS = 500;

export function useRefreshFeedback(
  onRefresh: () => void | Promise<void>,
  minimumMs = MINIMUM_REFRESH_FEEDBACK_MS,
) {
  const [refreshing, setRefreshing] = React.useState(false);
  const activeRef = React.useRef(false);
  const mountedRef = React.useRef(true);

  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const runRefresh = React.useCallback(async () => {
    if (activeRef.current) return;
    activeRef.current = true;
    setRefreshing(true);
    const startedAt = Date.now();

    try {
      await onRefresh();
    } finally {
      const remaining = Math.max(0, minimumMs - (Date.now() - startedAt));
      if (remaining > 0) {
        await new Promise<void>((resolve) => window.setTimeout(resolve, remaining));
      }
      activeRef.current = false;
      if (mountedRef.current) setRefreshing(false);
    }
  }, [minimumMs, onRefresh]);

  return { refreshing, runRefresh };
}
