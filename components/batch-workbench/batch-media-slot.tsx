"use client";
import { UiText, useUiLocale } from "@/i18n/ui";


import * as React from "react";
import { ImagePlus, LoaderCircle, Trash2, Upload } from "lucide-react";
import { ResilientImage } from "@/components/ui/resilient-image";
import { buildMediaPreviewCandidates } from "@/lib/media-url";
import { relationPreviewUrl, type BatchMediaRelation } from "@/components/batch-workbench/types";

export function BatchMediaSlot({
  label,
  relation,
  onUpload,
  onRemove,
  busy = false,
  multiple = false,
  hint,
}: {
  label: "产品图" | "参考图";
  relation?: BatchMediaRelation | null;
  onUpload: (files: File[]) => void | Promise<void>;
  onRemove?: () => void | Promise<void>;
  busy?: boolean;
  multiple?: boolean;
  hint?: string;
}) {
  const { text } = useUiLocale();
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const preview = relationPreviewUrl(relation);

  return (
    <div className="min-w-0">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-[var(--app-fg)]">{label}</span>
        {relation && onRemove ? (
          <button
            type="button"
            onClick={() => void onRemove()}
            disabled={busy}
            className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-[var(--app-muted)] transition-colors hover:bg-red-500/10 hover:text-red-500 disabled:opacity-50"
            aria-label={text("workspaceFollowup.mbc5e6bd4be1c", { v0: label })}
            title={text("workspaceFollowup.mbc5e6bd4be1c", { v0: label })}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>
      <button
        type="button"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
        className="group relative flex aspect-[4/3] w-full overflow-hidden rounded-2xl border border-dashed border-[var(--border)] bg-[var(--input-bg)] text-[var(--app-muted)] transition-colors hover:border-[var(--primary-bg)] hover:bg-[var(--panel-2)] disabled:cursor-wait"
      >
        {preview ? (
          <>
            <ResilientImage
              candidates={buildMediaPreviewCandidates(preview, { width: 420, height: 315 })}
              alt={label}
              className="h-full w-full object-cover"
              loading="lazy"
            />
            <span className="absolute inset-x-2 bottom-2 rounded-lg bg-black/60 px-2 py-1 text-center text-[10px] text-white opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100"><UiText id="batch.m978b1f980452" /></span>
          </>
        ) : (
          <span className="m-auto flex flex-col items-center gap-2 px-3 text-center">
            {busy ? <LoaderCircle className="h-5 w-5 animate-spin" /> : <ImagePlus className="h-5 w-5" />}
            <span className="text-[11px]">{busy ? <UiText id="batch.m403b055e56f5" /> : <UiText id="batch.m9191e1738319" />}</span>
            {hint ? <span className="text-[10px] opacity-65">{hint}</span> : null}
          </span>
        )}
      </button>
      <input
        ref={inputRef}
        className="sr-only"
        type="file"
        accept="image/*"
        multiple={multiple}
        onChange={(event) => {
          const files = Array.from(event.target.files || []);
          event.target.value = "";
          if (files.length) void onUpload(files);
        }}
      />
      {!relation && !busy ? (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-[var(--border)] bg-[var(--panel-bg)] px-2 py-2 text-[11px] text-[var(--app-muted)] transition-colors hover:bg-[var(--panel-2)] hover:text-[var(--app-fg)]"
        >
          <Upload className="h-3.5 w-3.5" /><UiText id="batch.m5a6f88a22f9a" />{label}
        </button>
      ) : null}
    </div>
  );
}
