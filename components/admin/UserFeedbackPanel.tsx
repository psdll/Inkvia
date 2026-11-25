"use client";
import { UiText, useUiLocale } from "@/i18n/ui";


import * as React from "react";
import { adminDisplayName, fmtTime } from "@/lib/admin-utils";

type FeedbackItem = {
  id: number;
  createdAt: string;
  feedbackType: string;
  content: string;
  attachments: string[];
  username?: string | null;
  userId?: string | null;
};

type UserFeedbackPanelProps = {
  feedbacks: FeedbackItem[];
  onRequestDelete: (id: number) => void;
  renderAttachments: (attachments: string[], keyPrefix: string) => React.ReactNode;
};

function feedbackTypeLabel(t: string) {
  if (t === "bug") return "提交 Bug";
  if (t === "complaint") return "我要吐槽";
  if (t === "idea") return "我有想法";
  return t;
}

export default function UserFeedbackPanel({ feedbacks, onRequestDelete, renderAttachments }: UserFeedbackPanelProps) {
  const { label: uiLabel } = useUiLocale();
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-[14px] font-semibold text-[var(--app-fg)]"><UiText id="admin.m7e6c14c21150" /></div>
        <div className="text-[12px] text-[var(--app-muted)]"><UiText id="admin.m2428420e407f" />{feedbacks.length}<UiText id="admin.m6fb2840d568a" /></div>
      </div>
      {feedbacks.length ? (
        <div className="space-y-3">
          {feedbacks.map((f) => (
            <div key={f.id} className="rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[11px] px-2 py-0.5 rounded-full border border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-500/20 dark:bg-blue-500/10 dark:text-blue-400">
                    {uiLabel(feedbackTypeLabel(f.feedbackType))}
                  </span>
                  <span className="text-[11px] text-[var(--app-muted)]">{fmtTime(f.createdAt)}</span>
                </div>
                <button
                  type="button"
                  onClick={() => onRequestDelete(f.id)}
                  className="h-7 px-2.5 rounded-lg border border-rose-200 bg-rose-50 text-rose-700 text-[11px] hover:bg-rose-500 hover:text-white transition disabled:opacity-50 dark:border-rose-500/25 dark:bg-rose-500/10 dark:text-rose-400"
                ><UiText id="admin.m8e30c529c03c" /></button>
              </div>
              <div className="mt-2 text-[13px] text-[var(--app-fg)] whitespace-pre-wrap break-words">{f.content || "-"}</div>
              {Array.isArray(f.attachments) && f.attachments.length > 0
                ? renderAttachments(f.attachments, `feedback_user_${f.id}`)
                : null}
              <div className="mt-2 text-[12px] text-[var(--app-muted)]"><UiText id="admin.m1a78d1d50196" />{adminDisplayName(f)}</div>
            </div>
          ))}
        </div>
      ) : (
        <div className="py-10 text-center text-[13px] text-[var(--app-muted)]"><UiText id="admin.md4ca05554006" /></div>
      )}
    </div>
  );
}
