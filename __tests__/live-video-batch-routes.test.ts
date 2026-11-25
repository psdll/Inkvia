import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const routes = [
  "app/api/live-video-batches/route.ts",
  "app/api/live-video-batches/models/route.ts",
  "app/api/live-video-batches/[batchId]/route.ts",
  "app/api/live-video-batches/[batchId]/media/route.ts",
  "app/api/live-video-batches/[batchId]/product-library/route.ts",
  "app/api/live-video-batches/[batchId]/status/route.ts",
  "app/api/live-video-batches/[batchId]/items/[itemId]/route.ts",
  "app/api/live-video-batches/[batchId]/items/[itemId]/media/route.ts",
  "app/api/live-video-batches/[batchId]/prompt-retry/route.ts",
  "app/api/live-video-batches/[batchId]/submit/route.ts",
  "app/api/live-video-batches/[batchId]/video-retry/route.ts",
];

describe("live video batch api routes", () => {
  it("keeps every operation in the isolated live-video route family", () => {
    for (const route of routes) expect(existsSync(route), route).toBe(true);
    const source = routes.map((route) => readFileSync(route, "utf8")).join("\n");
    expect(source).toContain("createLiveVideoBatch");
    expect(source).toContain("updateLiveVideoBatchDraft");
    expect(source).toContain("retryLiveVideoPrompt");
    expect(source).toContain("submitLiveVideoBatch");
    expect(source).toContain("retryLiveVideoOutput");
    expect(source).not.toContain("/api/image-batches");
  });

  it("authenticates batch reads, mutations, retries, and submission", () => {
    for (const route of routes.filter((route) => !route.includes("/models/"))) {
      expect(readFileSync(route, "utf8"), route).toContain("getUserId(req)");
    }
  });

  it("imports product-library items by stable ID without accepting a client URL", () => {
    const route = readFileSync(
      "app/api/live-video-batches/[batchId]/product-library/route.ts",
      "utf8",
    );
    expect(route).toContain("importLiveVideoBatchProductLibraryMedia");
    expect(route).toContain("productLibraryItemId");
    expect(route).toContain("requestKey");
    expect(route).toContain("expectedVersion");
    expect(route).not.toContain("fileUrl");
    expect(route).not.toContain("fetch(");
  });
});
