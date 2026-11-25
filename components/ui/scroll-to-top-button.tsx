"use client";
import { UiProps } from "@/i18n/ui";


import * as React from "react";
import { ArrowUp } from "lucide-react";

type ScrollTarget = {
  scrollTo(options: ScrollToOptions): void;
};

export function shouldShowScrollToTop(scrollTop: number, showAfter: number) {
  return scrollTop > showAfter;
}

export function scrollElementToTop(target: ScrollTarget | null) {
  target?.scrollTo({ top: 0, behavior: "smooth" });
}

export function ScrollToTopButton({
  scrollContainerRef,
  onScrollToTop,
  showAfter = 600,
  position = "fixed",
}: {
  scrollContainerRef: React.RefObject<HTMLElement>;
  onScrollToTop?: () => void;
  showAfter?: number;
  position?: "fixed" | "absolute";
}) {
  const [visible, setVisible] = React.useState(false);

  React.useEffect(() => {
    const scrollContainer = scrollContainerRef.current;
    if (!scrollContainer) return;

    const updateVisibility = () => {
      setVisible(shouldShowScrollToTop(scrollContainer.scrollTop, showAfter));
    };

    updateVisibility();
    scrollContainer.addEventListener("scroll", updateVisibility, {
      passive: true,
    });
    return () =>
      scrollContainer.removeEventListener("scroll", updateVisibility);
  }, [scrollContainerRef, showAfter]);

  return (
    <UiProps ids={{"aria-label":["common.m53d77f56548d"],"title":["common.m53d77f56548d"]}}><button
      type="button"
      onClick={() => {
        if (onScrollToTop) {
          onScrollToTop();
          return;
        }
        scrollElementToTop(scrollContainerRef.current);
      }}
      data-scroll-to-top
      aria-label="common.m53d77f56548d"
      aria-hidden={!visible}
      title="common.m53d77f56548d"
      tabIndex={visible ? 0 : -1}
      className={[
        position,
        "bottom-6 right-6 z-30 inline-flex h-12 w-12 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--panel-bg)] text-[var(--app-fg)] shadow-[var(--shadow-2)]",
        "transition-[opacity,transform,color,background-color,border-color] duration-200",
        "hover:border-[var(--primary-bg)] hover:bg-[var(--panel-2)] hover:text-[var(--primary-bg)]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary-bg)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--app-bg)]",
        visible
          ? "translate-y-0 opacity-100"
          : "pointer-events-none translate-y-2 opacity-0",
      ].join(" ")}
    >
      <ArrowUp className="h-5 w-5" strokeWidth={2.2} aria-hidden="true" />
    </button></UiProps>
  );
}
