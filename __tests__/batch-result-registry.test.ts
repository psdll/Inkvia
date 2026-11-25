import { readChineseUiSource as readFileSync } from "./helpers/chinese-ui-source";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  mergeBatchResultEntries,
  type BatchResultEntry,
  type BatchResultSource,
} from "@/components/batch-workbench/batch-result-registry";

function entry(
  key: string,
  createdAt: string,
  options?: Partial<BatchResultEntry>,
): BatchResultEntry {
  return {
    key,
    mode: "style_replication",
    modeLabel: "统一参考",
    mediaKind: "image",
    createdAt,
    content: null,
    ...options,
  };
}

function source(id: string, entries: BatchResultEntry[]): BatchResultSource {
  return {
    id,
    entries,
    hasMore: false,
    loadingMore: false,
    loadMore: () => undefined,
  };
}

describe("batch result registry", () => {
  it("merges independent sources by newest creation time", () => {
    const merged = mergeBatchResultEntries([
      source("image", [entry("image:older", "2026-08-18T10:00:00.000Z")]),
      source("live", [entry("live:newer", "2026-08-19T10:00:00.000Z", {
        mode: "live_video",
        modeLabel: "Live 视频",
        mediaKind: "video",
      })]),
    ]);

    expect(merged.map((item) => item.key)).toEqual(["live:newer", "image:older"]);
  });

  it("keeps the current editable draft pinned above history", () => {
    const merged = mergeBatchResultEntries([
      source("image", [
        entry("image:history", "2026-08-19T10:00:00.000Z"),
        entry("image:draft", "", { pinned: true }),
      ]),
    ]);

    expect(merged.map((item) => item.key)).toEqual(["image:draft", "image:history"]);
  });

  it("uses a stable key order for equal or invalid timestamps without dropping entries", () => {
    const merged = mergeBatchResultEntries([
      source("image", [
        entry("image:b", "invalid"),
        entry("image:a", "invalid"),
        entry("image:same-b", "2026-08-19T10:00:00.000Z"),
        entry("image:same-a", "2026-08-19T10:00:00.000Z"),
      ]),
    ]);

    expect(merged.map((item) => item.key)).toEqual([
      "image:same-a",
      "image:same-b",
      "image:a",
      "image:b",
    ]);
  });

  it("renders every source through one virtualized result list", () => {
    const unified = readFileSync(
      resolve(process.cwd(), "components/batch-workbench/unified-batch-results.tsx"),
      "utf8",
    );

    expect(unified.match(/<Virtuoso\b/g) || []).toHaveLength(1);
    expect(unified).toContain("mergeBatchResultEntries");
    expect(unified).not.toContain("entry.modeLabel");
    expect(unified).toContain("entry.mediaKind");
    expect(unified).toContain("increaseViewportBy");
    expect(unified).toContain("source.hasMore && !source.loadingMore");
    expect(unified).toContain("已展示全部任务 · 已经到底了");
  });

  it("animates visibly before aligning the exact first virtual item", () => {
    const unified = readFileSync(
      resolve(process.cwd(), "components/batch-workbench/unified-batch-results.tsx"),
      "utf8",
    );

    expect(unified).toContain("virtuosoRef.current?.scrollToIndex({");
    expect(unified).toContain('index: 0, align: "start", behavior: "auto"');
    expect(unified).toContain("window.requestAnimationFrame(animate)");
    expect(unified).toContain('scrollTo({ top: nextScrollTop, behavior: "auto" })');
    expect(unified).toContain("onScrollToTop={scrollToStart}");
    expect(unified).not.toContain('behavior: "smooth"');
  });
});
