"use client";
import { useUiLocale } from "@/i18n/ui";


import * as React from "react";
import { elapsedSeconds } from "@/lib/image-batch/contracts";

const STATUS_LABELS: Record<string, string> = {
  draft: "workspaceFollowup.m49933a195350",
  queued: "workspaceFollowup.md6f766f2adf5",
  submitting: "workspaceFollowup.mdcc1a22d9e72",
  waiting_provider: "workspaceFollowup.m0c5ef10ade70",
  running: "workspaceFollowup.m1f0eb99b7ed0",
  processing: "workspaceFollowup.m694b71bc8013",
  partial_success: "workspaceFollowup.m1bd16b45b478",
  success: "workspaceFollowup.mf28461bb49c8",
  failed: "workspaceFollowup.m28384d7afd2e",
  cancelled: "workspaceFollowup.ma37778f17c5f",
};

const STATUS_TONES: Record<string, string> = {
  success: "border-emerald-500/25 bg-emerald-500/10 text-emerald-500",
  partial_success: "border-amber-500/25 bg-amber-500/10 text-amber-500",
  failed: "border-red-500/25 bg-red-500/10 text-red-500",
  cancelled: "border-[var(--border)] bg-[var(--panel-2)] text-[var(--app-muted)]",
  running: "border-blue-500/25 bg-blue-500/10 text-blue-500",
  processing: "border-blue-500/25 bg-blue-500/10 text-blue-500",
  waiting_provider: "border-blue-500/25 bg-blue-500/10 text-blue-500",
  queued: "border-[var(--border)] bg-[var(--panel-2)] text-[var(--app-muted)]",
  draft: "border-[var(--border)] bg-[var(--panel-2)] text-[var(--app-muted)]",
};

export function BatchStatusBadge({
  status,
  startedAt,
  finishedAt,
  compact = false,
}: {
  status: string;
  startedAt?: string | null;
  finishedAt?: string | null;
  compact?: boolean;
}) {
  const { text, locale } = useUiLocale();
  const statusLabel = STATUS_LABELS[status] ? text(STATUS_LABELS[status]) : status;
  const [, tick] = React.useReducer((value) => value + 1, 0);
  const active = ["queued", "submitting", "waiting_provider", "running", "processing"].includes(status);

  React.useEffect(() => {
    if (!active || !startedAt) return;
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [active, startedAt]);

  const seconds = elapsedSeconds(startedAt, finishedAt);
  const displaySeconds = seconds === null ? "" : seconds.toLocaleString(locale === "en" ? "en-US" : "zh-CN", { useGrouping: locale === "en" });
  const timeLabel = seconds === null
    ? ""
    : active
      ? text("workspaceFollowup.m73266a3334ec", { v0: displaySeconds })
      : text("workspaceFollowup.m28d443446a11", { v0: displaySeconds });

  return (
    <span
      className={[
        "inline-flex min-w-0 items-center gap-1.5 rounded-full border font-medium",
        compact ? "px-2 py-1 text-[10px]" : "px-2.5 py-1 text-[11px]",
        STATUS_TONES[status] || STATUS_TONES.draft,
      ].join(" ")}
      title={[statusLabel, timeLabel].filter(Boolean).join(" · ")}
    >
      {active ? <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" /> : null}
      <span className="truncate">{statusLabel}</span>
      {timeLabel ? <span className="whitespace-nowrap opacity-80">· {timeLabel}</span> : null}
    </span>
  );
}
