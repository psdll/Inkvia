import * as React from "react";

export type PromptTextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;

export const PromptTextarea = React.forwardRef<HTMLTextAreaElement, PromptTextareaProps>(function PromptTextarea(
  { className = "", ...props },
  ref
) {
  const base =
    "w-full bg-[var(--input-bg)] border border-[var(--border)] focus:border-blue-500/40 focus:ring-1 focus:ring-blue-500/30 resize-none rounded-lg text-sm text-[var(--app-fg)] placeholder:text-[var(--app-muted)] px-3 py-2 outline-none leading-relaxed";

  return <textarea ref={ref} className={[base, className].filter(Boolean).join(" ")} {...props} />;
});
