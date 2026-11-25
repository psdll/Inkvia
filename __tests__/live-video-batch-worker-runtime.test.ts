import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("live video batch worker runtime", () => {
  it("runs prompt and video as explicit isolated roles", () => {
    const runner = readFileSync("scripts/live-video-batch-worker.ts", "utf8");
    expect(runner).toContain('role === "prompt"');
    expect(runner).toContain('role !== "video"');
    expect(runner).toContain("LIVE_VIDEO_PROMPT_CONCURRENCY");
    expect(runner).toContain("LIVE_VIDEO_VIDEO_CONCURRENCY");
    expect(runner).toContain('from "@/lib/live-video-batch/contracts"');
    expect(runner.match(/\|\| LIVE_VIDEO_BATCH_MAX_MEDIA/g)).toHaveLength(2);
    expect(runner).toContain("runLiveVideoPromptWorkerIteration");
    expect(runner).toContain("runLiveVideoVideoWorkerIteration");
  });

  it("starts and restarts the two roles independently in full development mode", () => {
    const runner = readFileSync("scripts/next-runner.cjs", "utf8");
    expect(runner).toContain("startLiveVideoPromptWorker");
    expect(runner).toContain("startLiveVideoVideoWorker");
    expect(runner).toContain('"--role=prompt"');
    expect(runner).toContain('"--role=video"');
    expect(runner).toContain("[live-video-prompt-worker] exited unexpectedly");
    expect(runner).toContain("[live-video-video-worker] exited unexpectedly");
  });
});
