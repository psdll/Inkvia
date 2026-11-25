import { describe, expect, it } from "vitest";
import { assertCanvasRunStepTransition, recoverCanvasRunStepStatus } from "@/lib/canvas/run-state-machine";

describe("canvas run step state machine", () => {
  it("allows the frozen provider submission path", () => {
    for (const [from, to] of [
      ["queued", "leased"],
      ["leased", "submitting"],
      ["submitting", "waiting_provider"],
      ["waiting_provider", "applying"],
      ["applying", "success"],
      ["waiting_provider", "retry_wait"],
      ["retry_wait", "queued"],
      ["submitting", "submission_unknown"],
      ["queued", "cancel_requested"],
      ["cancel_requested", "cancelled"],
    ] as const) expect(() => assertCanvasRunStepTransition(from, to)).not.toThrow();
  });

  it("does not permit resubmitting an unknown provider submission", () => {
    expect(() => assertCanvasRunStepTransition("submission_unknown", "queued")).toThrow(/RUN_STEP_INVALID_TRANSITION/);
    expect(() => assertCanvasRunStepTransition("success", "queued")).toThrow(/RUN_STEP_INVALID_TRANSITION/);
  });

  it("recovers leases without risking a duplicate paid submission", () => {
    expect(recoverCanvasRunStepStatus("leased")).toBe("queued");
    expect(recoverCanvasRunStepStatus("submitting")).toBe("submission_unknown");
    expect(recoverCanvasRunStepStatus("waiting_provider")).toBe("waiting_provider");
    expect(recoverCanvasRunStepStatus("applying")).toBe("applying");
  });
});
