import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("canvas development worker startup", () => {
  it("starts both durable generation and media workers with the dev server", () => {
    const runner = readFileSync("scripts/next-runner.cjs", "utf8");

    expect(runner).toContain("withWorkers");
    expect(runner).toContain('"--role=generation"');
    expect(runner).toContain('"--role=media"');
    expect(runner).toContain("[canvas-generation-worker] exited unexpectedly");
    expect(runner).toContain("[canvas-media-worker] exited unexpectedly");
  });
});
