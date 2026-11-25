import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  ScrollToTopButton,
  scrollElementToTop,
  shouldShowScrollToTop,
} from "@/components/ui/scroll-to-top-button";

describe("ScrollToTopButton", () => {
  it("only becomes visible after the scroll threshold is crossed", () => {
    expect(shouldShowScrollToTop(600, 600)).toBe(false);
    expect(shouldShowScrollToTop(601, 600)).toBe(true);
  });

  it("requests a smooth scroll back to the start", () => {
    let received: ScrollToOptions | undefined;

    scrollElementToTop({
      scrollTo(options) {
        received = options;
      },
    });

    expect(received).toEqual({ top: 0, behavior: "smooth" });
  });

  it("renders an accessible theme-token based circular control", () => {
    const html = renderToStaticMarkup(
      React.createElement(ScrollToTopButton, {
        scrollContainerRef: { current: null },
      }),
    );

    expect(html).toContain('aria-label="回到顶部"');
    expect(html).toContain("h-12 w-12");
    expect(html).toContain("rounded-full");
    expect(html).toContain("border-[var(--border)]");
    expect(html).toContain("bg-[var(--panel-bg)]");
    expect(html).toContain("text-[var(--app-fg)]");
    expect(html).toContain("shadow-[var(--shadow-2)]");
  });
});
