"use client";
import { UiProps, UiText } from "@/i18n/ui";


import * as React from "react";
import { createPortal } from "react-dom";
import {
  BatchMediaGallery,
  type BatchProductLibraryDrop,
} from "@/components/batch-workbench/batch-media-gallery";
import {
  BatchTaskResult,
  type BatchTaskPendingAction,
} from "@/components/batch-workbench/batch-task-result";
import {
  latestBatchOutputs,
  type BatchItem,
  type BatchMediaRelation,
  type ImageBatch,
} from "@/components/batch-workbench/types";

const PROMPT_TOOLTIP_DELAY_MS = 800;

export function BatchTaskCard({
  batchId,
  item,
  batchMode,
  allowMultipleProductMedia,
  defaultMedia,
  busy,
  promptBusy,
  uploadingRole,
  pendingAction = null,
  actionError = "",
  onChange,
  onCommit,
  onUpload,
  onImportProductLibraryItem,
  onRemoveMedia,
  onRetry,
  onRegenerate,
  onCancel,
  onPreviewResult,
}: {
  batchId: string;
  item: BatchItem;
  batchMode: ImageBatch["mode"];
  allowMultipleProductMedia: boolean;
  defaultMedia: BatchMediaRelation[];
  busy: boolean;
  promptBusy: boolean;
  uploadingRole: "product" | "reference" | null;
  pendingAction?: BatchTaskPendingAction;
  actionError?: string;
  onChange: (patch: Partial<BatchItem>) => void;
  onCommit?: () => void | Promise<void>;
  onUpload: (
    role: "product" | "reference",
    files: File[],
  ) => void | Promise<void>;
  onImportProductLibraryItem: (
    role: "product" | "reference",
    drop: BatchProductLibraryDrop,
  ) => void | Promise<void>;
  onRemoveMedia: (relation: BatchMediaRelation) => void | Promise<void>;
  onRetry?: () => void | Promise<void>;
  onRegenerate?: () => void | Promise<void>;
  onCancel?: () => void | Promise<void>;
  onPreviewResult?: (outputId: string) => void;
}) {
  const itemProducts = item.media.filter((entry) => entry.role === "product");
  const itemReferences = item.media.filter(
    (entry) => entry.role === "reference",
  );
  const defaultProduct = defaultMedia.find((entry) => entry.role === "product");
  const defaultReferences = defaultMedia.filter(
    (entry) => entry.role === "reference",
  );
  const products =
    itemProducts.length || batchMode === "style_replication"
      ? itemProducts
      : defaultProduct
        ? [defaultProduct]
        : [];
  const references =
    itemReferences.length || batchMode === "style_replication"
      ? itemReferences
      : defaultReferences;
  const containTaskMediaWheel =
    batchMode === "multi_prompt" || batchMode === "style_replication";
  const outputs = latestBatchOutputs(item.outputs || []);
  const downloadUrl = outputs[0]?.id
    ? `/api/image-batches/${batchId}/download?outputId=${encodeURIComponent(outputs[0].id)}`
    : "";
  const preservePromptSelection = batchMode === "style_replication";
  const [promptEditorOpen, setPromptEditorOpen] = React.useState(false);
  const [promptDraft, setPromptDraft] = React.useState(item.prompt);
  const [promptTooltipPosition, setPromptTooltipPosition] = React.useState<{
    left: number;
    top: number;
    maxHeight: number;
    placement: "above" | "below";
  } | null>(null);
  const promptTooltipTimerRef = React.useRef<number | null>(null);
  const promptEditorRef = React.useRef<HTMLElement | null>(null);

  const clearPromptTooltipTimer = () => {
    if (promptTooltipTimerRef.current === null) return;
    window.clearTimeout(promptTooltipTimerRef.current);
    promptTooltipTimerRef.current = null;
  };

  const hidePromptTooltip = () => {
    clearPromptTooltipTimer();
    setPromptTooltipPosition(null);
  };

  const schedulePromptTooltip = (target: HTMLElement) => {
    if (
      !item.prompt.trim()
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
  };

  React.useEffect(() => () => {
    if (promptTooltipTimerRef.current !== null) {
      window.clearTimeout(promptTooltipTimerRef.current);
    }
  }, []);

  React.useEffect(() => {
    if (!promptEditorOpen) setPromptDraft(item.prompt);
  }, [item.prompt, promptEditorOpen]);

  React.useEffect(() => {
    if (!promptEditorOpen) return;
    const closeOnOutside = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (target && !promptEditorRef.current?.contains(target)) {
        setPromptEditorOpen(false);
        void onCommit?.();
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setPromptEditorOpen(false);
        void onCommit?.();
      }
    };
    document.addEventListener("mousedown", closeOnOutside);
    document.addEventListener("touchstart", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutside);
      document.removeEventListener("touchstart", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [onCommit, promptEditorOpen]);

  return (
    <article
      className={`flex flex-col rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] shadow-[var(--shadow-2)] ${
        promptEditorOpen
          ? "overflow-visible"
          : "overflow-hidden"
      }`}
    >
      <section
        data-region="task-media-region"
        className={
          batchMode === "multi_prompt"
            ? "order-4 p-3"
            : "order-4 grid max-h-32 grid-cols-2 gap-2 overflow-y-auto p-3"
        }
      >
        {batchMode === "style_replication" ? (
          <UiProps ids={{"hint":["batch.m3371f2ab96b6"]}}><BatchMediaGallery
            label="参考图"
            relations={references}
            busy={uploadingRole === "reference"}
            disabled={busy}
            multiple
            compact
            containHorizontalWheel={containTaskMediaWheel}
            onUpload={(files) => onUpload("reference", files)}
            onImportProductLibraryItem={(drop) => onImportProductLibraryItem("reference", drop)}
            onRemove={onRemoveMedia}
            hint="batch.m3371f2ab96b6"
          /></UiProps>
        ) : null}
        <UiProps ids={{"hint":["batch.m15b1554b50ee"]}}><BatchMediaGallery
          label="产品图"
          relations={products}
          busy={uploadingRole === "product"}
          disabled={busy}
          multiple={allowMultipleProductMedia}
          compact
          showCompactHeader={batchMode !== "multi_prompt"}
          showCompactIndex={batchMode !== "multi_prompt"}
          containHorizontalWheel={containTaskMediaWheel}
          onUpload={(files) => onUpload(
            "product",
            allowMultipleProductMedia ? files : files.slice(0, 1),
          )}
          onImportProductLibraryItem={(drop) => onImportProductLibraryItem("product", drop)}
          onRemove={onRemoveMedia}
          hint="batch.m15b1554b50ee"
        /></UiProps>
      </section>

      <section
        data-region="task-result-region"
        className="order-2 flex aspect-[3/4] flex-none flex-col border-b border-[var(--border)]"
      >
        <div className="grid h-full min-h-0 grid-cols-1 gap-2">
          <BatchTaskResult
            output={outputs[0] || null}
            downloadUrl={downloadUrl}
            compact
            pendingAction={pendingAction}
            actionError={actionError}
            onPreview={() => onPreviewResult?.(outputs[0]!.id)}
            onRetry={onRetry}
            onRegenerate={onRegenerate}
            onCancel={onCancel}
          />
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
          disabled={promptBusy}
          onClick={() => {
            hidePromptTooltip();
            setPromptEditorOpen((open) => !open);
          }}
          aria-expanded={promptEditorOpen}
          aria-describedby={promptTooltipPosition ? `batch-task-prompt-tooltip-${item.id}` : undefined}
          className="flex h-6 w-full min-w-0 items-center bg-transparent px-0 text-left text-xs text-[var(--app-fg)] outline-none hover:text-[var(--primary-bg)] focus-visible:underline focus-visible:underline-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <span className="min-w-0 flex-1 truncate">
            {item.prompt || <UiText id="batch.m7e671c7dd025" />}
          </span>
        </button>
        {promptTooltipPosition && !promptEditorOpen && typeof document !== "undefined"
          ? createPortal(
              <div
                id={`batch-task-prompt-tooltip-${item.id}`}
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
                {item.prompt}
              </div>,
              document.body,
            )
          : null}
        {promptEditorOpen ? (
          <div
            className="absolute bottom-[calc(100%+8px)] left-3 z-40 h-52 w-[calc(100%-1.5rem)] rounded-md min-h-28 min-w-48 max-h-[60vh] max-w-[70vw] resize overflow-auto border border-[var(--batch-prompt-editor-border)] bg-[var(--batch-prompt-editor-bg)] p-3 shadow-[var(--shadow-2)] [container-type:size]"
          >
            <UiProps ids={{"placeholder":["batch.m28f413a8eb64"]}}><textarea
              autoFocus
              value={preservePromptSelection ? promptDraft : item.prompt}
              disabled={promptBusy}
              onChange={(event) => {
                const nextPrompt = event.target.value;
                if (preservePromptSelection) setPromptDraft(nextPrompt);
                onChange({ prompt: nextPrompt });
              }}
              onBlur={() => void onCommit?.()}
              rows={7}
              placeholder="batch.m28f413a8eb64"
              className="h-full w-full resize-none border-0 bg-transparent p-0 text-[clamp(0.75rem,calc(0.625rem_+_0.75cqi_+_0.35cqh),1.125rem)] leading-[1.6] text-[var(--app-fg)] outline-none placeholder:text-[var(--app-muted)]/60 disabled:cursor-not-allowed disabled:opacity-50"
            /></UiProps>
          </div>
        ) : null}
      </section>
    </article>
  );
}
