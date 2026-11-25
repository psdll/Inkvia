"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";

export function GenerateActionButton({
  busy = false,
  variant = "neutral",
  children,
  className = "",
  type = "button",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { busy?: boolean; variant?: "neutral" | "primary" }) {
  return (
    <button
      {...props}
      type={type}
      aria-busy={busy || undefined}
      className={[
        "inline-flex items-center justify-center font-medium transition-colors disabled:cursor-not-allowed",
        variant === "primary"
          ? "rounded-xl bg-[var(--primary-bg)] text-base text-[var(--primary-fg)] hover:bg-[var(--primary-hover)] disabled:bg-[var(--border)] disabled:text-[var(--app-muted)] disabled:hover:bg-[var(--border)]"
          : "rounded-full border border-[var(--batch-generate-border)] bg-[var(--batch-generate-bg)] text-xs text-[var(--batch-generate-fg)] shadow-[var(--shadow-2)] hover:bg-[var(--batch-generate-bg-hover)] disabled:opacity-45",
        className,
      ].join(" ")}
    >
      {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : null}
      <span className="whitespace-nowrap">{children}</span>
    </button>
  );
}
