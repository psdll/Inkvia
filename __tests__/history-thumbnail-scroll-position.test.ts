import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

vi.mock("react-virtuoso", async () => {
  const ReactModule = await import("react");
  return {
    Virtuoso: ReactModule.forwardRef<
      HTMLDivElement,
      {
        className?: string;
        components?: {
          Item?: React.ComponentType<Record<string, unknown>>;
        };
        horizontalDirection?: boolean;
        style?: Record<string, unknown>;
      }
    >(function MockVirtuoso({ className, components, horizontalDirection, style }, ref) {
      const Item = components?.Item;
      return ReactModule.createElement(
        "div",
        {
          ref,
          className,
          "data-horizontal": String(Boolean(horizontalDirection)),
          "data-overflow-y": String(style?.overflowY || ""),
          "data-padding-top": String(style?.paddingTop || ""),
          "data-box-sizing": String(style?.boxSizing || ""),
        },
        Item
          ? ReactModule.createElement(
              Item,
              {
                "data-index": 0,
                "data-item-index": 0,
                "data-known-size": 60,
                item: 1,
                style: { display: "inline-block" },
              },
              "item",
            )
          : null,
      );
    }),
  };
});

import {
  HISTORY_VIRTUALIZE_THRESHOLD,
  HistoryThumbnailStrip,
} from "@/components/history/history-thumbnail-strip";

const NumberHistoryThumbnailStrip = HistoryThumbnailStrip as React.ComponentType<{
  items: number[];
  getKey: (item: number) => React.Key;
  renderItem: (item: number) => React.ReactNode;
  hasMore?: boolean;
}>;

describe("history thumbnail scroll position", () => {
  it("moves only the strip horizontally when focusing a direct-list thumbnail", () => {
    const source = readFileSync(
      resolve(process.cwd(), "components/history/history-thumbnail-strip.tsx"),
      "utf8",
    );

    expect(source).not.toContain("scrollIntoView");
    expect(source).toContain("scroller.scrollLeft -= scrollerRect.left - itemRect.left");
    expect(source).toContain("scroller.scrollLeft += itemRect.right - scrollerRect.right");
  });

  it("locks the direct scroller to the horizontal axis and vertically centers every item", () => {
    const markup = renderToStaticMarkup(
      React.createElement(NumberHistoryThumbnailStrip, {
        items: [1],
        getKey: (item) => item,
        renderItem: (item) => React.createElement("span", null, item),
      }),
    );

    expect(markup).toContain(
      "no-scrollbar",
    );
    expect(markup).toContain("items-center");
    expect(markup).toContain("overflow-x-auto overflow-y-hidden");
    expect(markup).not.toContain("pt-2");
  });

  it("locks the virtualized scroller to the same vertical geometry", () => {
    const items = Array.from(
      { length: HISTORY_VIRTUALIZE_THRESHOLD + 1 },
      (_, index) => index,
    );
    const markup = renderToStaticMarkup(
      React.createElement(NumberHistoryThumbnailStrip, {
        items,
        getKey: (item) => item,
        renderItem: (item) => React.createElement("span", null, item),
      }),
    );

    expect(markup).toContain('data-horizontal="true"');
    expect(markup).toContain('class="no-scrollbar"');
    expect(markup).toContain('data-overflow-y="hidden"');
    expect(markup).toContain('data-padding-top=""');
    expect(markup).toContain('data-box-sizing="border-box"');
  });

  it("keeps a short paginated list virtualized until the final page is loaded", () => {
    const markup = renderToStaticMarkup(
      React.createElement(NumberHistoryThumbnailStrip, {
        items: [1],
        hasMore: true,
        getKey: (item) => item,
        renderItem: (item) => React.createElement("span", null, item),
      }),
    );

    expect(markup).toContain('data-horizontal="true"');
    expect(markup).not.toContain("overflow-x-auto");
  });

  it("vertically centers virtual item wrappers across task states", () => {
    const items = Array.from(
      { length: HISTORY_VIRTUALIZE_THRESHOLD + 1 },
      (_, index) => index,
    );
    const markup = renderToStaticMarkup(
      React.createElement(NumberHistoryThumbnailStrip, {
        items,
        getKey: (item) => item,
        renderItem: (item) => React.createElement("span", null, item),
      }),
    );

    expect(markup).toContain("display:inline-flex");
    expect(markup).toContain("align-items:center");
    expect(markup).toContain("height:100%");
    expect(markup).toContain("vertical-align:top");
  });
});
