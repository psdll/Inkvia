import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const board = readFileSync("components/canvas/SmartCanvasBoard.tsx", "utf8");

describe("canvas server-owned workflow execution", () => {
  it("fails closed when the run API does not select the durable server executor", () => {
    const startWorkflow = board.slice(
      board.indexOf("const startWorkflow"),
      board.indexOf("React.useEffect(() =>", board.indexOf("const startWorkflow")),
    );

    expect(startWorkflow).toContain("await flushBeforeServerRun()");
    expect(startWorkflow).toContain("expectedRevision");
    expect(startWorkflow).toContain('payload.executionMode !== "server"');
    expect(startWorkflow).toContain("pollServerRunRef.current(runId)");
    expect(startWorkflow).not.toContain("persistRun");
    expect(startWorkflow).not.toContain("executeCanvasLoop");
    expect(startWorkflow).not.toContain("await runNode");
    expect(board).not.toContain("const persistRun");
  });

  it("resumes polling all active server runs without exposing the removed log panel", () => {
    expect(board).toContain("CANVAS_ACTIVE_RUN_STATUSES");
    expect(board).toContain("activeServerRuns.current.set(run.id, run.state?.nodeIds || [])");
    expect(board).toContain("pollServerRunRef.current(run.id)");
    expect(board).not.toContain('setUtilityPanel("runs")');
    expect(board).not.toContain('aria-label="运行日志"');
    expect(board).not.toContain("data-canvas-cancel-run");
  });
});
