"use client";
import { UiText, useUiLocale } from "@/i18n/ui";


import * as React from "react";
import { parseFriendlyMessageFromStorage } from "@/lib/error-friendly";

export type FriendlyUiError = {
  title?: string;
  message: string;
  action?: string;
  requestId?: string | null;
  raw?: string;
};

function normalizeError(error: FriendlyUiError | string) {
  if (typeof error === "string") return parseFriendlyMessageFromStorage(error);
  const message = String(error?.message || "").trim() || "任务失败，请稍后重试。";
  const action = String(error?.action || "").trim();
  const requestId = String(error?.requestId || "").trim() || null;
  const raw = String(error?.raw || "").trim();
  return {
    title: String(error?.title || "任务失败"),
    message,
    action,
    requestId,
    raw: raw || message
  };
}

export function FriendlyErrorBlock({ error, defaultOpen = false }: { error: FriendlyUiError | string; defaultOpen?: boolean }) {
  const { error: localizeError } = useUiLocale();
  const parsed = normalizeError(error);
  return (
    <div className="w-full rounded-xl border border-rose-500/25 bg-rose-500/10 px-3 py-2 text-sm text-rose-700">
      <div className="font-medium">{localizeError(parsed.message)}</div>
      {parsed.action ? <div className="mt-1 text-xs text-rose-700/90"><UiText id="common.m98f7c0340484" />{localizeError(parsed.action, "请稍后重试。")}</div> : null}
      {(parsed.raw && parsed.raw !== parsed.message) || parsed.requestId ? (
        <details className="mt-2" open={defaultOpen}>
          <summary className="cursor-pointer text-xs text-rose-700/80"><UiText id="common.mc8086a97926b" /></summary>
          <div className="mt-2 rounded-lg border border-rose-400/20 bg-white/40 px-2 py-2 text-xs leading-5 text-rose-900/90 dark:bg-black/20 dark:text-rose-100/90 whitespace-pre-wrap break-all">
            {parsed.requestId ? <div className="mb-1"><UiText id="common.mfa4449fd25e0" />{parsed.requestId}</div> : null}
            {parsed.raw && parsed.raw !== parsed.message ? <div>{parsed.raw}</div> : null}
          </div>
        </details>
      ) : null}
    </div>
  );
}
