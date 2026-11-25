"use client";

import * as React from "react";

// The browser owns dragging, wheel scrolling and thumb sizing; this only controls visibility.
export function AutoHideScrollbar({ scrollRef }: { scrollRef: React.RefObject<HTMLElement | null> }) {
  React.useEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let hovering = false;
    const reveal = () => {
      scroll.dataset.scrollbarActive = "true";
      clearTimeout(timer);
      if (!hovering) timer = setTimeout(() => { scroll.dataset.scrollbarActive = "false"; }, 800);
    };
    const move = (event: PointerEvent) => {
      const bounds = scroll.getBoundingClientRect();
      const nearEdge = event.clientX >= bounds.right - 18 && event.clientX <= bounds.right;
      if (nearEdge === hovering) return;
      hovering = nearEdge;
      reveal();
    };
    const leave = () => { hovering = false; reveal(); };
    scroll.dataset.scrollbarActive = "false";
    scroll.addEventListener("scroll", reveal, { passive: true });
    scroll.addEventListener("pointermove", move, { passive: true });
    scroll.addEventListener("pointerleave", leave, { passive: true });
    return () => {
      clearTimeout(timer);
      scroll.removeEventListener("scroll", reveal);
      scroll.removeEventListener("pointermove", move);
      scroll.removeEventListener("pointerleave", leave);
      delete scroll.dataset.scrollbarActive;
    };
  }, [scrollRef]);
  return null;
}
