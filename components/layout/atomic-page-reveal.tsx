"use client";

import * as React from "react";

export function AtomicPageReveal({
  ready = true,
  children,
  className = "",
  onReveal,
}: {
  ready?: boolean;
  children: React.ReactNode;
  className?: string;
  onReveal?: () => void;
}) {
  const hasRevealedRef = React.useRef(false);
  const revealHrefRef = React.useRef(
    typeof window === "undefined" ? "" : `${window.location.pathname}${window.location.search}`,
  );
  const [revealed, setRevealed] = React.useState(false);
  const onRevealRef = React.useRef(onReveal);

  React.useEffect(() => {
    onRevealRef.current = onReveal;
  }, [onReveal]);

  React.useEffect(() => {
    if (!ready || hasRevealedRef.current) return;
    hasRevealedRef.current = true;
    setRevealed(true);
  }, [ready]);

  React.useEffect(() => {
    if (!revealed) return;
    onRevealRef.current?.();
    window.dispatchEvent(new CustomEvent("app:page-reveal-ready", {
      detail: {
        href: revealHrefRef.current,
      },
    }));
  }, [revealed]);

  return (
    <div
      className={["atomic-page-reveal", className].filter(Boolean).join(" ")}
      data-page-reveal-state={revealed ? "ready" : "pending"}
      aria-busy={!revealed}
    >
      <div className="atomic-page-reveal__content">{children}</div>
    </div>
  );
}
