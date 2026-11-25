"use client";
import { UiText, UiProps, useUiLocale } from "@/i18n/ui";



import * as React from "react";
import { Clock3, Download, Loader2, RotateCcw } from "lucide-react";
import { ResilientImage } from "@/components/ui/resilient-image";
import type { BatchOutput } from "@/components/batch-workbench/types";
import { isActiveBatchOutputStatus } from "@/components/batch-workbench/task-action-mode";
import { elapsedSeconds } from "@/lib/image-batch/contracts";
import { buildMediaPreviewCandidates } from "@/lib/media-url";

export type BatchTaskPendingAction = "retry" | "regenerate" | "cancel" | null;

export function BatchTaskResult({
  output,
  downloadUrl,
  compact,
  pendingAction,
  actionError,
  onPreview,
  onRetry,
  onRegenerate,
  onCancel,
}: {
  output: BatchOutput | null;
  downloadUrl: string;
  compact: boolean;
  pendingAction: BatchTaskPendingAction;
  actionError: string;
  onPreview?: () => void;
  onRetry?: () => void | Promise<void>;
  onRegenerate?: () => void | Promise<void>;
  onCancel?: () => void | Promise<void>;
}) {
  const { error: uiError } = useUiLocale();
  const [, tick] = React.useReducer((value) => value + 1, 0);
  const active = pendingAction !== null || isActiveBatchOutputStatus(output?.status);
  const path = output?.generation?.localPath || "";
  const failed = !active && output?.status === "failed";
  const cancelled = !active && ["cancelled", "canceled"].includes(output?.status || "");

  React.useEffect(() => {
    if (!active || !output?.startedAt) return;
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [active, output?.id, output?.startedAt]);

  const seconds = elapsedSeconds(
    output?.startedAt,
    active ? null : output?.finishedAt,
  ) ?? 0;
  const errorMessage = actionError
    || output?.errorMessage
    || output?.generation?.errorMsg
    || "生成失败，请重试";
  const frameClass = compact
    ? "relative h-full min-h-0 overflow-hidden"
    : "relative aspect-[4/3] overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--input-bg)]";

  if (active) {
    return (
      <div className={`${frameClass} flex flex-col items-center justify-center gap-3 text-[var(--app-muted)]`}>
        <Loader2 className="h-7 w-7 animate-spin text-[var(--primary-bg)]" aria-hidden="true" />
        <span className="inline-flex items-center gap-1.5 text-xs">
          <Clock3 className="h-3.5 w-3.5" aria-hidden="true" /><UiText id="batch.m6e580845bca5" />{seconds}s
        </span>
        {onCancel ? (
          <button
            type="button"
            onClick={() => void onCancel()}
            disabled={pendingAction !== null}
            aria-busy={pendingAction === "cancel"}
            className="text-[10px] text-[var(--app-muted)] opacity-60 underline-offset-2 transition-opacity hover:opacity-100 hover:underline disabled:cursor-not-allowed disabled:opacity-40"
          >
            {pendingAction === "cancel" ? <UiText id="batch.m0addd7784578" /> : <UiText id="batch.m537d17f1c531" />}
          </button>
        ) : null}
      </div>
    );
  }

  if (cancelled) {
    return (
      <div className={`${frameClass} flex flex-col items-center justify-center gap-2.5 text-[var(--app-muted)]`}>
        <span className="text-[11px]"><UiText id="batch.ma37778f17c5f" /></span>
        {onRegenerate ? (
          <button
            type="button"
            onClick={() => void onRegenerate()}
            disabled={pendingAction !== null}
            aria-busy={pendingAction === "regenerate"}
            className="inline-flex h-7 items-center justify-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] px-2.5 text-[10px] text-[var(--app-muted)] transition-colors hover:border-[var(--primary-bg)] hover:text-[var(--primary-bg)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RotateCcw className="h-3 w-3" aria-hidden="true" /><UiText id="batch.m3221a042ea36" /></button>
        ) : null}
      </div>
    );
  }

  if (failed) {
    return (
      <div className={`${frameClass} flex flex-col items-center justify-center gap-3 px-4 text-center`}>
        <div className="max-h-32 w-full overflow-y-auto">
          <p className="text-xs font-semibold text-red-500"><UiText id="batch.m470f92db3d64" /></p>
          <p className="mt-1 whitespace-pre-wrap break-words text-[11px] leading-5 text-red-500/90">
            {uiError(errorMessage)}
          </p>
        </div>
        {onRetry ? (
          <UiProps ids={{"aria-label":["batch.m37960b383588"],"title":["batch.m37960b383588"]}}><button
            type="button"
            onClick={() => void onRetry()}
            disabled={pendingAction !== null}
            aria-label="batch.m37960b383588"
            title="batch.m37960b383588"
            aria-busy={pendingAction === "retry"}
            className="inline-flex h-9 min-w-28 items-center justify-center gap-2 rounded-xl bg-[var(--primary-bg)] px-4 text-xs font-semibold text-[var(--primary-fg)] shadow-[var(--shadow-2)] hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RotateCcw className="h-4 w-4" aria-hidden="true" /><UiText id="batch.mb8784c8dd563" /></button></UiProps>
        ) : null}
      </div>
    );
  }

  if (path) {
    return (
      <div className={`${frameClass} ${compact ? "group" : ""}`}>
        <UiProps ids={{"aria-label":["batch.m94e2fdaf346b"],"title":["batch.m94e2fdaf346b"]}}><a
          href={downloadUrl}
          download
          aria-label="batch.m94e2fdaf346b"
          title="batch.m94e2fdaf346b"
          className={
            compact
              ? "pointer-events-none absolute right-1.5 top-1.5 z-10 inline-flex h-7 w-7 items-center justify-center rounded-md border border-transparent bg-transparent text-white/80 opacity-0 drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)] transition-opacity hover:text-white focus-visible:pointer-events-auto focus-visible:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100"
              : "absolute right-2 top-2 z-10 inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] text-[var(--app-fg)] shadow-[var(--shadow-2)] transition-colors hover:border-[var(--primary-bg)] hover:text-[var(--primary-bg)]"
          }
        >
          <Download className="h-3.5 w-3.5" aria-hidden="true" />
        </a></UiProps>
        <UiProps ids={{"aria-label":["batch.m6e5a809405ca"]}}><button
          type="button"
          onClick={onPreview}
          className="h-full w-full cursor-zoom-in focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--primary-bg)]"
          aria-label="batch.m6e5a809405ca"
        >
          <UiProps ids={{"alt":["batch.ma78c1924def7"]}}><ResilientImage
            candidates={buildMediaPreviewCandidates(path, { width: 480, height: 540 })}
            alt="batch.ma78c1924def7"
            className={`h-full w-full ${compact ? "object-contain" : "object-cover"}`}
            loading="lazy"
          /></UiProps>
        </button></UiProps>
        <div className="absolute inset-x-2 bottom-2 flex items-end justify-between gap-2">
          {actionError ? (
            <span className="max-w-[65%] rounded-lg border border-red-500/25 bg-[var(--panel-bg)] px-2 py-1 text-[10px] leading-4 text-red-500 shadow-[var(--shadow-2)]">
              {uiError(actionError)}
            </span>
          ) : <span />}
          {onRegenerate ? (
            <UiProps ids={{"aria-label":["batch.m3221a042ea36"],"title":["batch.m5bfe431a6e9f"]}}><button
              type="button"
              onClick={() => void onRegenerate()}
              disabled={pendingAction !== null}
              aria-label="batch.m3221a042ea36"
              title="batch.m5bfe431a6e9f"
              aria-busy={pendingAction === "regenerate"}
              className={
                compact
                  ? "pointer-events-none inline-flex h-7 shrink-0 items-center justify-center gap-1 rounded-lg border border-transparent bg-transparent px-2.5 text-[11px] font-semibold text-white opacity-0 drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)] transition-opacity focus-visible:pointer-events-auto focus-visible:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100 disabled:cursor-not-allowed"
                  : "inline-flex h-7 shrink-0 items-center justify-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] px-2.5 text-[11px] font-semibold text-[var(--app-fg)] shadow-[var(--shadow-2)] hover:border-[var(--primary-bg)] hover:text-[var(--primary-bg)] disabled:cursor-not-allowed disabled:opacity-50"
              }
            >
              <RotateCcw className="h-3 w-3" aria-hidden="true" /><UiText id="batch.m3221a042ea36" /></button></UiProps>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className={`${frameClass} flex items-center justify-center text-[10px] text-[var(--app-muted)]`}><UiText id="batch.m49933a195350" /></div>
  );
}
