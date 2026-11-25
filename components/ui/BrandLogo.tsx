"use client";

import * as React from "react";

export default function BrandLogo({
  size = 40,
  variant = "mark",
  style,
  className,
  onClick,
}: {
  size?: number;
  variant?: "mark" | "wordmark";
  style?: React.CSSProperties;
  className?: string;
  onClick?: () => void;
}) {
  const gradientId = React.useId();
  const paint = `url(#${gradientId})`;
  const mark = (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden="true" style={variant === "mark" ? style : undefined} className={variant === "mark" ? className : undefined} onClick={variant === "mark" ? onClick : undefined}>
      <defs>
        <linearGradient id={gradientId} x1="8" y1="8" x2="56" y2="56" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#2EE6A8" />
          <stop offset="1" stopColor="#8A7BFF" />
        </linearGradient>
      </defs>
      <circle cx="21" cy="16" r="6.5" fill={paint} />
      <path d="M21 30V40Q21 50 31 50H43" stroke={paint} strokeWidth="9" strokeLinecap="round" />
    </svg>
  );
  if (variant === "mark") return mark;

  return (
    <span aria-hidden="true" className={`inline-flex items-center font-sora ${className ?? ""}`} style={style} onClick={onClick}>
      {mark}
      <span style={{ marginLeft: size * 0.06, fontSize: size * 0.68, fontWeight: 600, lineHeight: 1, letterSpacing: "-0.015em", color: "var(--app-fg)" }}>Inkvia</span>
    </span>
  );
}
