// @vitest-environment ./__tests__/jsdom-no-canvas-environment.ts
import { describe, it } from "vitest";
import { verifyVideoFrameOutput } from "./helpers/canvas-board-contract-harness";

describe("canvas captured frame nodes", () => {
  it.each(["video", "videoTask"] as const)("creates named portrait, landscape and square frames from %s", async kind => {
    for (const mode of ["current", "first", "last"] as const) await verifyVideoFrameOutput(kind, mode, "success");
  });
  it.each(["failure", "source-changed"] as const)("does not create an incorrect node after %s", outcome => verifyVideoFrameOutput("videoTask", "current", outcome));
});
