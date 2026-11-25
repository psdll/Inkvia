import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("canvas submission_unknown reconciliation", () => {
  it("freezes the run without automatically requeueing or cancelling sibling steps", () => {
    const source = readFileSync("lib/canvas/run-queue.ts", "utf8");
    expect(source).toContain("if (input.submissionUnknown)");
    expect(source).toContain("'submission_unknown'");
    expect(source).toContain("reconcileCanvasSubmissionUnknown");
    expect(source).toContain("retry_not_submitted");
    expect(source).toContain("attach_provider_request");
  });

  it("provides an explicit operator command instead of automatic paid resubmission", () => {
    const source = readFileSync("scripts/canvas-reconcile-submission.ts", "utf8");
    expect(source).toContain("--decision=retry_not_submitted|attach_provider_request|fail");
    expect(source).toContain("reconcileCanvasSubmissionUnknown");
    expect(source).not.toContain("submitImageGeneration");
  });
});
