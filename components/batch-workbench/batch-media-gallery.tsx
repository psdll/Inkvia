"use client";

import { UiText, UiProps, useUiLocale } from "@/i18n/ui";


import * as React from "react";
import { ImagePlus, Trash2, Upload, X } from "lucide-react";
import { MediaLightbox } from "@/components/ui/media-lightbox";
import { ResilientImage } from "@/components/ui/resilient-image";
import { useAuth } from "@/components/auth/AuthProvider";
import { buildMediaPreviewCandidates } from "@/lib/media-url";
import { createToolClientUuid } from "@/lib/tool-media/client-draft";
import {
  MEDIA_LIBRARY_DRAG_ITEMS_TYPE,
  readMediaLibraryDragItems,
} from "@/lib/media-library-drag";
import {
  relationPreviewUrl,
  type BatchMediaRelation,
} from "@/components/batch-workbench/types";

export type BatchProductLibraryDrop = {
  productLibraryItemId: number;
  requestKey: string;
};

function isSupportedBatchMediaDrag(dataTransfer: DataTransfer) {
  const types = Array.from(dataTransfer.types || []);
  return types.includes("Files")
    || types.includes(MEDIA_LIBRARY_DRAG_ITEMS_TYPE)
    || types.includes("application/x-media-library-item-id");
}

function readProductLibraryDrop(dataTransfer: DataTransfer) {
  const grouped = readMediaLibraryDragItems(dataTransfer);
  if (grouped.length) {
    return grouped.map((item) => ({
      kind: item.kind,
      productLibraryItemId: item.id,
      valid: true,
    }));
  }
  const productLibraryItemId = Number.parseInt(dataTransfer.getData("application/x-media-library-item-id"), 10);
  return [{
    kind: String(dataTransfer.getData("application/x-media-library-kind") || "").trim(),
    productLibraryItemId,
    valid: Number.isSafeInteger(productLibraryItemId) && productLibraryItemId > 0,
  }];
}

export function BatchMediaGallery({
  label,
  relations,
  busy = false,
  clearing = false,
  disabled = false,
  multiple = true,
  compact = false,
  showCompactHeader = true,
  showCompactIndex = true,
  containHorizontalWheel = false,
  dropzone = false,
  dropzoneSize = "default",
  compactHeaderActions = false,
  showSummary = true,
  maxFiles,
  hint,
  onUpload,
  onImportProductLibraryItem,
  onRemove,
  onClear,
  onLimitExceeded,
}: {
  label: "产品图" | "参考图" | "图片素材";
  relations: BatchMediaRelation[];
  busy?: boolean;
  clearing?: boolean;
  disabled?: boolean;
  multiple?: boolean;
  compact?: boolean;
  showCompactHeader?: boolean;
  showCompactIndex?: boolean;
  containHorizontalWheel?: boolean;
  dropzone?: boolean;
  dropzoneSize?: "default" | "large";
  compactHeaderActions?: boolean;
  showSummary?: boolean;
  maxFiles?: number;
  hint?: string;
  onUpload: (files: File[]) => void | Promise<void>;
  onImportProductLibraryItem?: (
    drop: BatchProductLibraryDrop,
  ) => void | Promise<void>;
  onRemove: (relation: BatchMediaRelation) => void | Promise<void>;
  onClear?: () => void | Promise<void>;
  onLimitExceeded?: (message: string) => void;
}) {
  const { user, openLoginModal } = useAuth();
  const { text } = useUiLocale();
  const displayLabel = text(label === "参考图" ? "batch.gallery_reference" : label === "产品图" ? "batch.gallery_product" : "batch.gallery_image");
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const compactScrollerRef = React.useRef<HTMLDivElement | null>(null);
  const [dragActive, setDragActive] = React.useState(false);
  const [previewIndex, setPreviewIndex] = React.useState<number | null>(null);
  const remaining = maxFiles
    ? Math.max(0, maxFiles - relations.length)
    : Number.POSITIVE_INFINITY;
  const canUpload = !busy && !clearing && !disabled && remaining > 0;
  const uploadSummary = [
    hint,
    text("workspaceFollowup.m8f3636ea4d68", { v0: relations.length }),
    maxFiles ? text("workspaceFollowup.m6e8708ff9fc3", { v0: maxFiles }) : "",
  ]
    .filter(Boolean)
    .join(" · ");

  React.useEffect(() => {
    if (!compact || !containHorizontalWheel) return;
    const target = compactScrollerRef.current;
    if (!target) return;
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (target.scrollWidth <= target.clientWidth) return;
      const delta = event.deltaX || event.deltaY;
      target.scrollLeft += delta;
    };
    target.addEventListener("wheel", handleWheel, { passive: false });
    return () => target.removeEventListener("wheel", handleWheel);
  }, [compact, containHorizontalWheel]);

  const requestFileSelection = () => {
    if (!canUpload) return;
    if (!user) {
      openLoginModal();
      return;
    }
    inputRef.current?.click();
  };

  const uploadFiles = (files: File[]) => {
    if (busy || clearing || disabled) return;
    if (!user) {
      openLoginModal();
      return;
    }
    const images = files.filter(
      (file) =>
        file.type.startsWith("image/") ||
        /\.(avif|gif|jpe?g|png|webp)$/i.test(file.name),
    );
    if (maxFiles && images.length > remaining) {
      onLimitExceeded?.(
        text("workspaceFollowup.m7d0c7e71e904", { v0: displayLabel, v1: maxFiles, v2: relations.length, v3: remaining }),
      );
      return;
    }
    if (images.length) void onUpload(images);
  };
  const handleDragEnter = (event: React.DragEvent<HTMLDivElement>) => {
    if (!canUpload || !isSupportedBatchMediaDrag(event.dataTransfer)) return;
    event.preventDefault();
    setDragActive(true);
  };
  const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    if (!canUpload || !isSupportedBatchMediaDrag(event.dataTransfer)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setDragActive(true);
  };
  const handleDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
    const related = event.relatedTarget;
    if (related instanceof Node && event.currentTarget.contains(related)) return;
    setDragActive(false);
  };
  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragActive(false);
    if (!canUpload) return;
    const files = Array.from(event.dataTransfer.files || []);
    if (files.length) {
      uploadFiles(files);
      return;
    }
    const droppedItems = readProductLibraryDrop(event.dataTransfer);
    if (!droppedItems.length || droppedItems.some((item) => !item.valid)) {
      onLimitExceeded?.(text("workspaceFollowup.ma07b014665a2"));
      return;
    }
    if (droppedItems.some((item) => item.kind && item.kind !== "image")) {
      onLimitExceeded?.(text("workspaceFollowup.m3b467e5523d6", { v0: displayLabel }));
      return;
    }
    if (!multiple && droppedItems.length > 1) {
      onLimitExceeded?.(text("workspaceFollowup.me6f05444a963", { v0: displayLabel }));
      return;
    }
    if (Number.isFinite(remaining) && droppedItems.length > remaining) {
      onLimitExceeded?.(text("workspaceFollowup.m575423e8e48f", { v0: displayLabel, v1: remaining }));
      return;
    }
    if (!user) {
      openLoginModal();
      return;
    }
    if (!onImportProductLibraryItem) {
      onLimitExceeded?.(text("workspaceFollowup.ma07b014665a2"));
      return;
    }
    void droppedItems.reduce<Promise<void>>(
      (chain, dropped) => chain.then(() => Promise.resolve(onImportProductLibraryItem({
        productLibraryItemId: dropped.productLibraryItemId,
        requestKey: createToolClientUuid(),
      }))),
      Promise.resolve(),
    );
  };
  const activePreviewIndex =
    previewIndex !== null && relations.length
      ? Math.min(previewIndex, relations.length - 1)
      : null;
  const activePreview =
    activePreviewIndex === null
      ? null
      : relationPreviewUrl(relations[activePreviewIndex]);
  const previewLightbox = (
    <MediaLightbox
      open={activePreviewIndex !== null && Boolean(activePreview)}
      src={activePreview}
      kind="image"
      title={displayLabel}
      layout="floating"
      counter={
        activePreviewIndex === null
          ? undefined
          : `${activePreviewIndex + 1}/${relations.length}`
      }
      counterAlwaysVisible
      dots={
        activePreviewIndex !== null && relations.length > 1
          ? { count: relations.length, activeIndex: activePreviewIndex }
          : undefined
      }
      hasPrev={activePreviewIndex !== null && activePreviewIndex > 0}
      hasNext={
        activePreviewIndex !== null && activePreviewIndex < relations.length - 1
      }
      onPrev={() =>
        setPreviewIndex((current) =>
          current === null ? null : Math.max(0, current - 1),
        )
      }
      onNext={() =>
        setPreviewIndex((current) =>
          current === null ? null : Math.min(relations.length - 1, current + 1),
        )
      }
      onClose={() => setPreviewIndex(null)}
    />
  );

  if (dropzone) {
    return (
      <>
        <section className="min-w-0">
          <div className="mb-2 flex min-w-0 items-center gap-2">
            <span className="shrink-0 whitespace-nowrap text-[13px] font-semibold leading-5 text-[var(--app-fg)]">
              {displayLabel}
            </span>
            <div className={`flex min-w-0 flex-1 items-center ${compactHeaderActions ? "justify-end gap-1" : "gap-2"}`}>
              {showSummary ? (
                <span
                  className="min-w-0 flex-1 cursor-pointer truncate text-[10px] text-[var(--app-muted)] transition-colors hover:text-[var(--primary-bg)]"
                  title={uploadSummary}
                >
                  {uploadSummary}
                </span>
              ) : null}
              {relations.length && remaining > 0 ? (
                <button
                  type="button"
                  disabled={!canUpload || clearing}
                  onClick={requestFileSelection}
                  className={`inline-flex shrink-0 items-center border border-[var(--border)] bg-[var(--panel-bg)] text-[var(--app-fg)] transition-colors hover:bg-[var(--panel-2)] disabled:cursor-wait disabled:opacity-50 ${compactHeaderActions ? "h-6 gap-0.5 rounded-md px-1.5 text-[9px]" : "h-7 gap-1 rounded-lg px-2 text-[10px]"}`}
                >
                  <ImagePlus className={compactHeaderActions ? "h-3 w-3" : "h-3.5 w-3.5"} />
                  {busy ? <UiText id="batch.m403b055e56f5" /> : <UiText id="batch.m9f0d4e4656ee" />}
                </button>
              ) : null}
              {relations.length && onClear ? (
                <button
                  type="button"
                  disabled={busy || clearing || disabled}
                  onClick={() => void onClear()}
                  className={`inline-flex shrink-0 items-center border border-red-500/30 bg-[var(--panel-bg)] text-red-500 transition-colors hover:bg-red-500/10 disabled:cursor-wait disabled:opacity-50 ${compactHeaderActions ? "h-6 gap-0.5 rounded-md px-1.5 text-[9px]" : "h-7 gap-1 rounded-lg px-2 text-[10px]"}`}
                >
                  <Trash2 className={compactHeaderActions ? "h-3 w-3" : "h-3.5 w-3.5"} />
                  {clearing ? <UiText id="batch.m509c3ded7832" /> : <UiText id="batch.mb730d8da2058" />}
                </button>
              ) : null}
            </div>
          </div>

          <div
            className={[
              "relative min-h-0 overflow-hidden rounded-2xl border border-dashed bg-[var(--input-bg)] p-2 transition-colors",
              dropzoneSize === "large"
                ? "h-[clamp(220px,30dvh,300px)]"
                : "h-[clamp(104px,17dvh,176px)]",
              dragActive
                ? "border-[var(--primary-bg)] bg-[color-mix(in_srgb,var(--primary-bg)_8%,var(--input-bg))] ring-2 ring-[color-mix(in_srgb,var(--primary-bg)_22%,transparent)]"
                : "border-[var(--border)]",
            ].join(" ")}
            onDragEnter={handleDragEnter}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            {relations.length ? (
              <div
                className={[
                  "grid h-full gap-2",
                  relations.length === 1
                    ? "grid-cols-1"
                    : relations.length === 2
                      ? "grid-cols-2"
                      : relations.length <= 4
                        ? "grid-cols-2 grid-rows-2"
                        : "grid-cols-3 auto-rows-[96px] overflow-y-auto",
                ].join(" ")}
              >
                {relations.map((relation, index) => {
                  const preview = relationPreviewUrl(relation);
                  return (
                    <div
                      key={relation.id}
                      className="group relative min-h-0 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--panel-bg)]"
                    >
                      {preview ? (
                        <button
                          type="button"
                          onClick={() => setPreviewIndex(index)}
                          className="h-full w-full cursor-zoom-in focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--primary-bg)]"
                          aria-label={text("workspaceFollowup.m7f180b46807a", { v0: displayLabel, v1: index + 1 })}
                        >
                          <ResilientImage
                            candidates={buildMediaPreviewCandidates(
                              preview,
                              relations.length === 1
                                ? { width: 720, height: 480 }
                                : { width: 240, height: 240 },
                            )}
                            alt={`${label} ${index + 1}`}
                            className={`h-full w-full ${relations.length === 1 ? "object-contain" : "object-cover"}`}
                            loading="lazy"
                          />
                        </button>
                      ) : null}
                      <span className="pointer-events-none absolute bottom-1 left-1 z-10 rounded-md bg-black/60 px-1.5 py-0.5 text-[9px] text-white">
                        {index + 1}
                      </span>
                      {relation.pending ? (
                        <span className="pointer-events-none absolute inset-x-1 bottom-1 z-10 truncate rounded-md bg-black/70 px-1.5 py-0.5 text-center text-[9px] text-white"><UiText id="batch.m403b055e56f5" /></span>
                      ) : null}
                      <UiProps ids={{"title":["batch.m2f9daa828907"]}}><button
                        type="button"
                        disabled={relation.pending || busy || clearing || disabled}
                        onClick={() => void onRemove(relation)}
                        className="absolute right-0.5 top-0.5 z-10 inline-flex h-3.5 w-3.5 items-center justify-center rounded-[4px] bg-black/60 text-white opacity-0 shadow-sm transition-[opacity,background-color] hover:bg-red-500 group-hover:opacity-100 focus-visible:opacity-100 disabled:opacity-40"
                        aria-label={text("workspaceFollowup.m248797e131b2", { v0: displayLabel, v1: index + 1 })}
                        title="batch.m2f9daa828907"
                      >
                        <X className="h-2.5 w-2.5" />
                      </button></UiProps>
                    </div>
                  );
                })}
              </div>
            ) : (
              <button
                type="button"
                disabled={!canUpload}
                onClick={requestFileSelection}
                className="flex h-full w-full flex-col items-center justify-center gap-3 rounded-xl text-[var(--app-muted)] transition-colors hover:text-[var(--app-fg)] disabled:cursor-wait disabled:opacity-50"
              >
                <span className="flex h-14 w-14 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--panel-bg)] shadow-[var(--shadow-2)]">
                  <Upload className="h-5 w-5" />
                </span>
                <span className="text-center">
                  <span className="block text-xs font-medium text-[var(--app-fg)]">
                    {busy ? <UiText id="batch.m403b055e56f5" /> : <UiText id="batch.maadd89aae1ed" />}
                  </span>
                  <span className="mt-1 block text-[10px]"><UiText id="batch.m6e6ff907e2cf" /></span>
                </span>
              </button>
            )}
            <input
              ref={inputRef}
              className="sr-only"
              type="file"
              accept="image/*"
              multiple={multiple}
              disabled={!canUpload}
              onChange={(event) => {
                const files = Array.from(event.target.files || []);
                event.target.value = "";
                uploadFiles(files);
              }}
            />
          </div>
        </section>
        {previewLightbox}
      </>
    );
  }

  return (
    <>
      <section className="min-w-0">
        {compact && !showCompactHeader ? null : (
          <div
            className={
              compact
                ? "mb-1.5 flex items-center justify-between gap-1"
                : "mb-2 flex items-center justify-between gap-2"
            }
          >
            <span
              className={
                compact
                  ? "text-[10px] font-medium text-[var(--app-fg)]"
                  : "text-xs font-medium text-[var(--app-fg)]"
              }
            >
              {displayLabel}
              {relations.length ? (
                <span className="ml-1 font-normal text-[var(--app-muted)]">
                  {relations.length}<UiText id="batch.me9e0fdc242b4" /></span>
              ) : null}
            </span>
            {!compact && hint ? (
              <span className="text-[10px] text-[var(--app-muted)]">
                {hint}
              </span>
            ) : null}
          </div>
        )}

        <div
          ref={compactScrollerRef}
          className={[
            compact
              ? "flex min-w-0 flex-nowrap gap-1.5 overflow-x-auto rounded-lg [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              : "grid grid-cols-3 gap-2 rounded-xl",
            containHorizontalWheel ? "overscroll-x-contain" : "",
            dragActive
              ? "ring-2 ring-[color-mix(in_srgb,var(--primary-bg)_42%,transparent)]"
              : "",
          ].join(" ")}
          onDragEnter={handleDragEnter}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onWheel={compact && !containHorizontalWheel ? (event) => {
            const target = event.currentTarget;
            if (target.scrollWidth <= target.clientWidth) return;
            const delta = event.deltaX || event.deltaY;
            const canScroll = delta < 0
              ? target.scrollLeft > 0
              : target.scrollLeft + target.clientWidth < target.scrollWidth - 1;
            if (!canScroll) return;
            event.preventDefault();
            target.scrollLeft += delta;
          } : undefined}
        >
          {relations.map((relation, index) => {
            const preview = relationPreviewUrl(relation);
            return (
              <div
                key={relation.id}
                className={[
                  "group relative overflow-hidden border border-[var(--border)] bg-[var(--input-bg)]",
                  compact
                    ? "h-12 w-12 shrink-0 rounded-lg"
                    : "aspect-square rounded-xl",
                ].join(" ")}
              >
                {preview ? (
                  <button
                    type="button"
                    onClick={() => setPreviewIndex(index)}
                    className="h-full w-full cursor-zoom-in focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--primary-bg)]"
                    aria-label={text("workspaceFollowup.m7f180b46807a", { v0: displayLabel, v1: index + 1 })}
                  >
                    <ResilientImage
                      candidates={buildMediaPreviewCandidates(
                        preview,
                        compact
                          ? { width: 120, height: 120 }
                          : { width: 240, height: 240 },
                      )}
                      alt={`${label} ${index + 1}`}
                      className="h-full w-full object-cover"
                      loading="lazy"
                    />
                  </button>
                ) : null}
                {!compact || showCompactIndex ? (
                  <span className="pointer-events-none absolute bottom-1 left-1 z-10 rounded-md bg-black/60 px-1.5 py-0.5 text-[9px] text-white">
                    {index + 1}
                  </span>
                ) : null}
                {relation.pending ? (
                  <span className="pointer-events-none absolute inset-x-1 bottom-1 z-10 truncate rounded-md bg-black/70 px-1.5 py-0.5 text-center text-[9px] text-white"><UiText id="batch.m403b055e56f5" /></span>
                ) : null}
                <UiProps ids={{"title":["batch.m2f9daa828907"]}}><button
                  type="button"
                  disabled={relation.pending || busy || clearing || disabled}
                  onClick={() => void onRemove(relation)}
                  className="absolute right-0.5 top-0.5 z-10 inline-flex h-3.5 w-3.5 items-center justify-center rounded-[4px] bg-black/60 text-white opacity-0 shadow-sm transition-[opacity,background-color] hover:bg-red-500 group-hover:opacity-100 focus-visible:opacity-100 disabled:opacity-40"
                  aria-label={text("workspaceFollowup.m248797e131b2", { v0: displayLabel, v1: index + 1 })}
                  title="batch.m2f9daa828907"
                >
                  <X className="h-2.5 w-2.5" />
                </button></UiProps>
              </div>
            );
          })}

          <button
            type="button"
            disabled={!canUpload}
            onClick={requestFileSelection}
            className={[
              "flex flex-col items-center justify-center border border-dashed border-[var(--border)] bg-[var(--input-bg)] px-1 text-center text-[10px] text-[var(--app-muted)] transition-colors hover:border-[var(--primary-bg)] hover:bg-[var(--panel-2)] hover:text-[var(--app-fg)] disabled:cursor-wait disabled:opacity-50",
              compact
                ? "h-12 w-12 shrink-0 gap-1 rounded-lg"
                : "aspect-square min-h-20 gap-1.5 rounded-xl",
            ].join(" ")}
          >
            <ImagePlus className="h-4 w-4" />
            <span>{busy ? <UiText id="batch.m403b055e56f5" /> : compact ? <UiText id="batch.m7a8a11ead507" /> : <UiText id="batch.m1122ed1364a6" values={{v0: String(label)}} />}</span>
          </button>
        </div>

        <input
          ref={inputRef}
          className="sr-only"
          type="file"
          accept="image/*"
          multiple={multiple}
          disabled={!canUpload}
          onChange={(event) => {
            const files = Array.from(event.target.files || []);
            event.target.value = "";
            uploadFiles(files);
          }}
        />
      </section>
      {previewLightbox}
    </>
  );
}
