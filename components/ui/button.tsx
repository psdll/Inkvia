import * as React from "react";

export type ButtonVariant = "default" | "secondary" | "ghost";
export type ButtonSize = "default" | "none";

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className = "", variant = "default", size = "default", type = "button", ...props },
  ref
) {
  const base =
    "inline-flex items-center justify-center rounded-md text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_srgb,var(--primary-bg)_28%,transparent)] disabled:opacity-50 disabled:pointer-events-none";

  const variants: Record<ButtonVariant, string> = {
    default: "bg-[var(--primary-bg)] text-[var(--primary-fg)] hover:bg-[var(--primary-hover)] btn-primary",
    secondary: "border border-[var(--border)] bg-[var(--panel-2)] text-[var(--app-fg)] hover:bg-[var(--panel-3)]",
    ghost: "bg-transparent text-[var(--app-muted)] hover:bg-[var(--panel-2)] hover:text-[var(--app-fg)]"
  };

  const sizes: Record<ButtonSize, string> = {
    default: "px-4 py-2",
    none: ""
  };

  return (
    <button
      ref={ref}
      type={type}
      className={[base, variants[variant], sizes[size], className].filter(Boolean).join(" ")}
      {...props}
    />
  );
});
