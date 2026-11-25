"use client";
import { UiProps, UiText, useUiLocale } from "@/i18n/ui";


import * as React from "react";
import { createPortal } from "react-dom";
import { Download, Loader2, RefreshCw } from "lucide-react";
import {
  BatchMediaGallery,
  type BatchProductLibraryDrop,
} from "@/components/batch-workbench/batch-media-gallery";
import type { BatchMediaRelation } from "@/components/batch-workbench/types";
import { AppVideoPlayer } from "@/components/ui/app-video-player";
import { MediaImage } from "@/components/ui/media-image";
import { MediaLightbox } from "@/components/ui/media-lightbox";
import type {
  LiveVideoBatch,
  LiveVideoBatchItem,
  LiveVideoBatchOutput,
} from "@/hooks/use-live-video-batch-workspace";
import { elapsedSeconds } from "@/lib/image-batch/contracts";
import { normalizeMediaUrl } from "@/lib/media-url";

const ACTIVE_VIDEO_STATUSES = new Set(["queued", "submitting", "waiting_provider"]);
const PROMPT_TOOLTIP_DELAY_MS = 800;

function latestOutput(item: LiveVideoBatchItem) {
  return [...(item.outputs || [])]
    .sort((left, right) => right.attempt - left.attempt)[0] || null;
}

function latestSuccessfulOutput(item: LiveVideoBatchItem) {
  return [...(item.outputs || [])]
    .filter((output) => (
      output.status === "success"
      && output.generation?.localPath?.toLowerCase().endsWith(".mp4")
    ))
    .sort((left, right) => right.attempt - left.attempt)[0] || null;
}

function latestPromptError(item: LiveVideoBatchItem) {
  return [...(item.promptJobs || [])]
    .sort((left, right) => right.attempt - left.attempt)[0]?.errorMessage || "";
}

function generationPosterUrl(generation: LiveVideoBatchOutput["generation"]) {
  const templateData = generation?.templateData;
  if (!templateData) return "";
  try {
    const params = JSON.parse(templateData) as Record<string, unknown>;
    return normalizeMediaUrl(params.outputPosterUrl || params.outputThumbUrl || "");
  } catch {
    return "";
  }
}

export function liveVideoItemMediaRelations(
  item: LiveVideoBatchItem,
): BatchMediaRelation[] {
  if (!item.sourceMedia) return [];
  return [{
    id: item.sourceMedia.id,
    itemId: item.id,
    role: "product",
    position: 0,
    media: item.sourceMedia,
  }];
}

function videoStatusLabel(
  item: LiveVideoBatchItem,
  output: LiveVideoBatchOutput | null,
  seconds: number,
  text: ReturnType<typeof useUiLocale>["text"],
) {
  if (output?.status === "success") return text("workspaceFollowup.m767dc812d1f7");
  if (output?.status === "failed") return text("workspaceFollowup.m5a586025ef2c");
  if (output && ACTIVE_VIDEO_STATUSES.has(output.status)) {
    return text("workspaceFollowup.m1b31164b8e9c", { v0: seconds });
  }
  if (item.promptStatus === "prompt_running") return text("workspaceFollowup.m767807b30ac7");
  if (item.promptStatus === "prompt_queued") return text("workspaceFollowup.m28a2321fb765");
  if (item.promptStatus === "prompt_failed") return text("workspaceFollowup.m601052c12ab9");
  if (item.promptStatus === "prompt_ready") return text("workspaceFollowup.m44a670f93ce5");
  return text("workspaceFollowup.m537f24b3f90e");
}

export type LiveVideoTaskCardProps = {
  batch: LiveVideoBatch;
  item: LiveVideoBatchItem;
  pending: boolean;
  onPromptCommit(prompt: string): void;
  onMediaUpload(files: File[]): void;
  onImportProductLibraryItem(drop: BatchProductLibraryDrop): void;
  onMediaRemove(): void;
  onPromptRetry(): void;
  onVideoRetry(): void;
};

export function LiveVideoTaskCard({
  batch,
  item,
  pending,
  onPromptCommit,
  onMediaUpload,
  onImportProductLibraryItem,
  onMediaRemove,
  onPromptRetry,
  onVideoRetry,
}: LiveVideoTaskCardProps) {
  const { text, error } = useUiLocale();
  const [prompt, setPrompt] = React.useState(item.prompt || "");
  const [videoPreviewOpen, setVideoPreviewOpen] = React.useState(false);
  const [videoReadyUrl, setVideoReadyUrl] = React.useState("");
  const [mediaInViewport, setMediaInViewport] = React.useState(false);
  const [, tick] = React.useReducer((value) => value + 1, 0);
  const [promptEditorOpen, setPromptEditorOpen] = React.useState(false);
  const [promptTooltipPosition, setPromptTooltipPosition] = React.useState<{
    left: number;
    top: number;
    maxHeight: number;
    placement: "above" | "below";
  } | null>(null);
  const promptTooltipTimerRef = React.useRef<number | null>(null);
  const promptEditorRef = React.useRef<HTMLElement | null>(null);
  const cardRef = React.useRef<HTMLElement | null>(null);
  const lastCommittedPromptRef = React.useRef(item.prompt.trim());
  const output = latestOutput(item);
  const successful = latestSuccessfulOutput(item);
  const videoUrl = normalizeMediaUrl(successful?.generation?.localPath || "");
  const posterUrl = generationPosterUrl(successful?.generation);
  const videoReady = Boolean(videoUrl && videoReadyUrl === videoUrl);
  const promptActive = item.promptStatus === "prompt_queued"
    || item.promptStatus === "prompt_running";
  const videoActive = Boolean(output && ACTIVE_VIDEO_STATUSES.has(output.status));
  const busy = pending || promptActive || videoActive;
  const downloadUrl = `/api/live-video-batches/${batch.id}/items/${item.id}/download`;

  React.useEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    if (!("IntersectionObserver" in window)) {
      setMediaInViewport(true);
      return;
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry?.isIntersecting) return;
      setMediaInViewport(true);
      observer.disconnect();
    }, { rootMargin: "600px 0px" });
    observer.observe(card);
    return () => observer.disconnect();
  }, []);

  React.useEffect(() => {
    if (!videoActive || !output?.startedAt) return;
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [videoActive, output?.id, output?.startedAt]);

  const seconds = elapsedSeconds(
    output?.startedAt,
    null,
  ) ?? 0;

  React.useEffect(() => {
    lastCommittedPromptRef.current = item.prompt.trim();
    setPrompt(item.prompt || "");
  }, [item.prompt]);

  const clearPromptTooltipTimer = React.useCallback(() => {
    if (promptTooltipTimerRef.current === null) return;
    window.clearTimeout(promptTooltipTimerRef.current);
    promptTooltipTimerRef.current = null;
  }, []);

  const hidePromptTooltip = React.useCallback(() => {
    clearPromptTooltipTimer();
    setPromptTooltipPosition(null);
  }, [clearPromptTooltipTimer]);

  const schedulePromptTooltip = React.useCallback((target: HTMLElement) => {
    if (
      promptActive
      || !prompt.trim()
      || promptEditorOpen
      || document.querySelector('[data-region="task-prompt-region"] textarea')
    ) return;
    clearPromptTooltipTimer();
    promptTooltipTimerRef.current = window.setTimeout(() => {
      promptTooltipTimerRef.current = null;
      if (
        !target.isConnected
        || document.querySelector('[data-region="task-prompt-region"] textarea')
      ) return;
      const bounds = target.getBoundingClientRect();
      const tooltipHalfWidth = Math.min(260, (window.innerWidth - 32) / 2);
      const availableAbove = bounds.top - 16;
      const availableBelow = window.innerHeight - bounds.bottom - 16;
      const placement = availableAbove >= 240 || availableAbove >= availableBelow
        ? "above"
        : "below";
      setPromptTooltipPosition({
        left: Math.min(
          Math.max(bounds.left + bounds.width / 2, tooltipHalfWidth + 16),
          window.innerWidth - tooltipHalfWidth - 16,
        ),
        top: placement === "above" ? bounds.top - 8 : bounds.bottom + 8,
        maxHeight: Math.max(
          96,
          (placement === "above" ? availableAbove : availableBelow) - 8,
        ),
        placement,
      });
    }, PROMPT_TOOLTIP_DELAY_MS);
  }, [clearPromptTooltipTimer, prompt, promptActive, promptEditorOpen]);

  const commitPrompt = React.useCallback(() => {
    const next = prompt.trim();
    if (!next) {
      setPrompt(lastCommittedPromptRef.current);
      return;
    }
    if (next === lastCommittedPromptRef.current) return;
    lastCommittedPromptRef.current = next;
    setPrompt(next);
    onPromptCommit(next);
  }, [onPromptCommit, prompt]);

  React.useEffect(() => () => {
    if (promptTooltipTimerRef.current !== null) {
      window.clearTimeout(promptTooltipTimerRef.current);
    }
  }, []);

  React.useEffect(() => {
    if (!promptEditorOpen) return;
    const closeOnOutside = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (target && !promptEditorRef.current?.contains(target)) {
        commitPrompt();
        setPromptEditorOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      commitPrompt();
      setPromptEditorOpen(false);
    };
    document.addEventListener("mousedown", closeOnOutside);
    document.addEventListener("touchstart", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutside);
      document.removeEventListener("touchstart", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [commitPrompt, promptEditorOpen]);

  const statusLabel = videoStatusLabel(item, output, seconds, text);
  const promptFailed = item.promptStatus === "prompt_failed";
  const outputFailed = output?.status === "failed";

  return (
    <>
    <article
      ref={cardRef}
      className={`flex flex-col rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] shadow-[var(--shadow-2)] ${
        promptEditorOpen ? "overflow-visible" : "overflow-hidden"
      }`}
    >
      <section
        data-region="task-result-region"
        className="order-2 flex aspect-[3/4] flex-none flex-col border-b border-[var(--border)]"
      >
        <div className="group relative h-full min-h-0 overflow-hidden bg-[var(--input-bg)]">
          {videoUrl ? (
            <>
              {posterUrl ? (
                <MediaImage
                  src={posterUrl}
                  alt=""
                  className={`pointer-events-none absolute inset-0 h-full w-full object-contain transition-opacity duration-200 ${
                    videoReady ? "opacity-0" : "opacity-100"
                  }`}
                  loading="lazy"
                />
              ) : null}
              {mediaInViewport ? (
                <AppVideoPlayer
                  compact
                  controlsOnHover
                  showCenterControl={false}
                  playOnSurfaceClick={false}
                  onClick={() => setVideoPreviewOpen(true)}
                  preload="metadata"
                  playsInline
                  poster={posterUrl || undefined}
                  src={videoUrl}
                  data-video-ready={videoReady ? "true" : "false"}
                  onCanPlay={() => setVideoReadyUrl(videoUrl)}
                  className="h-full w-full bg-black object-contain"
                  containerClassName={`h-full w-full transition-opacity duration-200 ${
                    videoReady ? "opacity-100" : "opacity-0"
                  }`}
                />
              ) : null}
              <UiProps ids={{"aria-label":["batch.mdbd91c3186c8"],"title":["batch.mdbd91c3186c8"]}}><a
                href={downloadUrl}
                aria-label="batch.mdbd91c3186c8"
                title="batch.mdbd91c3186c8"
                className="pointer-events-none absolute right-1.5 top-1.5 z-10 inline-flex h-7 w-7 items-center justify-center rounded-md bg-black/45 text-white/80 opacity-0 transition-opacity hover:text-white focus-visible:pointer-events-auto focus-visible:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100"
              >
                <Download className="h-3.5 w-3.5" aria-hidden="true" />
              </a></UiProps>
            </>
          ) : videoActive || promptActive ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-[var(--app-muted)]">
              <Loader2 className="h-7 w-7 animate-spin text-[var(--primary-bg)]" aria-hidden="true" />
              <span className="text-xs">{statusLabel}</span>
            </div>
          ) : outputFailed ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 px-4 text-center">
              <div className="max-h-32 w-full overflow-y-auto">
                <p className="text-xs font-semibold text-red-500"><UiText id="batch.m5a586025ef2c" /></p>
                <p className="mt-1 whitespace-pre-wrap break-words text-[11px] leading-5 text-red-500/90">
                  {error(output.errorMessage || output.generation?.errorMsg, text("batch.m7a3097550ded"))}
                </p>
              </div>
              <button
                type="button"
                onClick={onVideoRetry}
                disabled={pending}
                className="inline-flex h-9 min-w-28 items-center justify-center gap-2 rounded-xl bg-[var(--primary-bg)] px-4 text-xs font-semibold text-[var(--primary-fg)] disabled:opacity-50"
              >
                <RefreshCw className="h-4 w-4" aria-hidden="true" /><UiText id="batch.m4b726740a0e7" /></button>
            </div>
          ) : promptFailed ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 px-4 text-center">
              <div className="max-h-32 w-full overflow-y-auto">
                <p className="text-xs font-semibold text-red-500"><UiText id="batch.m601052c12ab9" /></p>
                {latestPromptError(item) ? (
                  <p className="mt-1 whitespace-pre-wrap break-words text-[11px] leading-5 text-red-500/90">
                    {error(latestPromptError(item))}
                  </p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={onPromptRetry}
                disabled={pending}
                className="inline-flex h-9 min-w-28 items-center justify-center gap-2 rounded-xl bg-[var(--primary-bg)] px-4 text-xs font-semibold text-[var(--primary-fg)] disabled:opacity-50"
              >
                <RefreshCw className="h-4 w-4" aria-hidden="true" /><UiText id="batch.mb5c99862b2a4" /></button>
            </div>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-[var(--app-muted)]">
              <span className="text-[10px]">{statusLabel}</span>
            </div>
          )}
        </div>
      </section>

      <section
        ref={promptEditorRef}
        data-region="task-prompt-region"
        onMouseEnter={(event) => schedulePromptTooltip(event.currentTarget)}
        onMouseLeave={hidePromptTooltip}
        className="relative order-3 border-b border-[var(--border)] p-3"
      >
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            hidePromptTooltip();
            setPromptEditorOpen((open) => !open);
          }}
          aria-expanded={promptEditorOpen}
          aria-describedby={promptTooltipPosition ? `live-video-prompt-tooltip-${item.id}` : undefined}
          className="flex h-6 w-full min-w-0 items-center bg-transparent px-0 text-left text-xs text-[var(--app-fg)] outline-none hover:text-[var(--primary-bg)] focus-visible:underline focus-visible:underline-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <span className="min-w-0 flex-1 truncate">
            {prompt || <UiText id="batch.m7e671c7dd025" />}
          </span>
        </button>
        {promptTooltipPosition && !promptEditorOpen && typeof document !== "undefined"
          ? createPortal(
              <div
                id={`live-video-prompt-tooltip-${item.id}`}
                role="tooltip"
                style={{
                  left: promptTooltipPosition.left,
                  top: promptTooltipPosition.top,
                  maxHeight: promptTooltipPosition.maxHeight,
                }}
                className={`pointer-events-none fixed z-[100] w-[min(520px,calc(100vw-32px))] -translate-x-1/2 overflow-y-auto break-words rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] px-3 py-2 text-sm leading-6 text-[var(--app-fg)] shadow-[var(--shadow-2)] ${
                  promptTooltipPosition.placement === "above" ? "-translate-y-full" : ""
                }`}
              >
                {prompt}
              </div>,
              document.body,
            )
          : null}
        {promptEditorOpen ? (
          <div className="absolute bottom-[calc(100%+8px)] left-3 z-40 h-52 w-[calc(100%-1.5rem)] rounded-md min-h-28 min-w-48 max-h-[60vh] max-w-[70vw] resize overflow-auto border border-[var(--batch-prompt-editor-border)] bg-[var(--batch-prompt-editor-bg)] p-3 shadow-[var(--shadow-2)] [container-type:size]">
            <UiProps ids={{"placeholder":["batch.m8a77f4e4f1f6"]}}><textarea
              autoFocus
              value={prompt}
              disabled={busy}
              onChange={(event) => setPrompt(event.target.value)}
              onBlur={commitPrompt}
              rows={7}
              placeholder="batch.m8a77f4e4f1f6"
              className="h-full w-full resize-none border-0 bg-transparent p-0 text-[clamp(0.75rem,calc(0.625rem_+_0.75cqi_+_0.35cqh),1.125rem)] leading-[1.6] text-[var(--app-fg)] outline-none placeholder:text-[var(--app-muted)]/60 disabled:cursor-not-allowed disabled:opacity-50"
            /></UiProps>
          </div>
        ) : null}
      </section>

      <section
        data-region="task-media-region"
        className="order-4 p-3"
      >
        <UiProps ids={{"hint":["batch.m15b1554b50ee"]}}><BatchMediaGallery
          label="产品图"
          relations={liveVideoItemMediaRelations(item)}
          busy={pending}
          disabled={busy}
          multiple={false}
          compact
          showCompactHeader
          showCompactIndex
          onUpload={(files) => onMediaUpload(files.slice(0, 1))}
          onImportProductLibraryItem={onImportProductLibraryItem}
          onRemove={() => onMediaRemove()}
          hint="batch.m15b1554b50ee"
        /></UiProps>
      </section>
    </article>
    <UiProps ids={{"title":["batch.m56e56614fed0"]}}><MediaLightbox
      open={videoPreviewOpen}
      src={videoUrl || null}
      kind="video"
      title="batch.m56e56614fed0"
      onClose={() => setVideoPreviewOpen(false)}
    /></UiProps>
    </>
  );
}
