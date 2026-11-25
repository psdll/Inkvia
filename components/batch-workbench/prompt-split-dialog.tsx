"use client";

import { UiProps, UiText } from "@/i18n/ui";


import * as React from "react";
import { X } from "lucide-react";
import { IMAGE_BATCH_LIMITS } from "@/lib/image-batch/contracts";

export function PromptSplitDialog({
  open,
  busy,
  onClose,
  onApply,
}: {
  open: boolean;
  busy: boolean;
  onClose: () => void;
  onApply: (text: string) => void | Promise<void>;
}) {
  const [text, setText] = React.useState("");
  const prompts = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const limitExceeded = prompts.length > IMAGE_BATCH_LIMITS.maxItems;
  if (!open) return null;

  return (
    <UiProps ids={{"aria-label":["batch.m2da9aa5a6c6d"]}}><div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="batch.m2da9aa5a6c6d">
      <div className="w-full max-w-xl rounded-[24px] border border-[var(--border)] bg-[var(--panel-bg)] p-5 shadow-[var(--shadow)]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-[var(--app-fg)]"><UiText id="batch.mf5e69e6902ab" /></h2>
            <p className="mt-1 text-xs text-[var(--app-muted)]"><UiText id="batch.m6e6582e54c99" /></p>
          </div>
          <UiProps ids={{"aria-label":["batch.m3fd47edce45b"]}}><button type="button" onClick={onClose} className="rounded-lg p-2 text-[var(--app-muted)] hover:bg-[var(--panel-2)]" aria-label="batch.m3fd47edce45b"><X className="h-4 w-4" /></button></UiProps>
        </div>
        <UiProps ids={{"placeholder":["batch.m4b0d41061791"]}}><textarea autoFocus value={text} onChange={(event) => setText(event.target.value)} rows={10} placeholder={"batch.m4b0d41061791"} className="mt-4 w-full resize-y rounded-2xl border border-[var(--border)] bg-[var(--input-bg)] px-3 py-3 text-sm leading-6 text-[var(--app-fg)] outline-none placeholder:text-[var(--app-muted)]/55 focus:ring-2 focus:ring-[color-mix(in_srgb,var(--primary-bg)_24%,transparent)]" /></UiProps>
        <div className="mt-3 flex items-center justify-between gap-3">
          <span className={limitExceeded ? "text-xs text-red-500" : "text-xs text-[var(--app-muted)]"}>
            {limitExceeded
              ? <UiText id="batch.mb7d2b117944f" values={{v0: String(IMAGE_BATCH_LIMITS.maxItems), v1: String(prompts.length - IMAGE_BATCH_LIMITS.maxItems)}} />
              : <UiText id="batch.ma4bbad18696d" values={{v0: String(prompts.length), v1: String(IMAGE_BATCH_LIMITS.maxItems)}} />}
          </span>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="h-10 rounded-xl border border-[var(--border)] bg-[var(--panel-2)] px-4 text-xs text-[var(--app-fg)]"><UiText id="batch.m2cd0f3be8738" /></button>
            <button type="button" disabled={busy || !prompts.length || limitExceeded} onClick={() => void onApply(text)} className="h-10 rounded-xl bg-[var(--primary-bg)] px-4 text-xs font-medium text-[var(--primary-fg)] disabled:cursor-not-allowed disabled:opacity-50">{busy ? <UiText id="batch.m694b71bc8013" /> : <UiText id="batch.md2ff17f44817" />}</button>
          </div>
        </div>
      </div>
    </div></UiProps>
  );
}
