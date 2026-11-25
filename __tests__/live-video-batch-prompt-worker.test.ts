import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("live video batch prompt worker", () => {
  it("claims only prompt jobs with expired or empty leases", () => {
    const source = readFileSync("lib/live-video-batch/prompt-worker.ts", "utf8");
    expect(source).toContain("LiveVideoPromptJob");
    expect(source).toContain("FOR UPDATE SKIP LOCKED");
    expect(source).toContain(`"status" IN ('queued', 'running')`);
    expect(source).toContain(`"leaseUntil" IS NULL OR "leaseUntil" < NOW()`);
    expect(source).not.toContain("LiveVideoBatchOutput");
  });

  it("passes exactly the current job image into one prompt execution", () => {
    const source = readFileSync("lib/live-video-batch/prompt-worker.ts", "utf8");
    expect(source).toContain("generateLiveVideoPrompt({");
    expect(source).toContain("mediaUrl: String(mediaSnapshot.mediaUrl");
    expect(source).not.toContain("mediaUrls:");
  });

  it("claims a full ten-image group in one concurrent iteration", () => {
    const source = readFileSync("lib/live-video-batch/prompt-worker.ts", "utf8");
    expect(source).toContain("limit = LIVE_VIDEO_BATCH_MAX_MEDIA");
    expect(source).toContain("Math.min(LIVE_VIDEO_BATCH_MAX_MEDIA, limit)");
    expect(source).toContain("concurrency = LIVE_VIDEO_BATCH_MAX_MEDIA");
    expect(source).toContain("await Promise.all(ids.map");
  });
});
