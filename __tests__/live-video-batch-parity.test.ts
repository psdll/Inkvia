import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("live video batch custom parity", () => {
  it("formats one stable Shanghai calendar date", async () => {
    const path = "lib/live-video-batch/date.ts";
    expect(existsSync(path)).toBe(true);
    const { formatLiveVideoBatchShanghaiDate } = await import(
      "@/lib/live-video-batch/date"
    );

    expect(formatLiveVideoBatchShanghaiDate("2026-08-07T15:59:59.000Z")).toBe(
      "2026-08-07",
    );
    expect(formatLiveVideoBatchShanghaiDate("2026-08-07T16:00:00.000Z")).toBe(
      "2026-08-08",
    );
  });

  it("uses the next custom-batch style group number without reusing deleted names", async () => {
    const path = "lib/live-video-batch/naming.ts";
    expect(existsSync(path)).toBe(true);
    const { nextLiveVideoBatchName } = await import(
      "@/lib/live-video-batch/naming"
    );

    expect(nextLiveVideoBatchName([])).toBe("分组#1");
    expect(nextLiveVideoBatchName([
      { name: "分组#2" },
      { name: "旧标题" },
      { name: "分组#7" },
    ])).toBe("分组#8");
  });

  it("makes a live task source image optional and adds a dedicated media route", () => {
    const schema = readFileSync("prisma/schema.prisma", "utf8");
    const route = "app/api/live-video-batches/[batchId]/items/[itemId]/media/route.ts";

    expect(schema).toContain("sourceMediaId  String?");
    expect(schema).toContain("sourceMedia    MediaAsset?");
    expect(existsSync(route)).toBe(true);
    expect(readFileSync(route, "utf8")).toContain(
      "uploadAndReplaceLiveVideoItemMedia",
    );
    expect(readFileSync(route, "utf8")).toContain(
      "detachLiveVideoItemMedia",
    );
  });

  it("protects media still referenced by a live task from release", () => {
    const source = readFileSync("lib/tool-media/service.ts", "utf8");
    expect(source).toContain("liveVideoBatchItems: { none: {} }");
  });
});
