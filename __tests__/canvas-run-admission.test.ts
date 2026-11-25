import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const queue = readFileSync("lib/canvas/run-queue.ts", "utf8");

describe("canvas run admission", () => {
  it("serializes starts and rejects stale, duplicate-active, and overloaded runs", () => {
    expect(queue).toContain("expectedRevision");
    expect(queue).toContain("CANVAS_STALE_REVISION");
    expect(queue).toContain("pg_advisory_xact_lock");
    expect(queue).toContain("CANVAS_RUN_ACTIVE");
    expect(queue).toContain("CANVAS_USER_QUEUE_LIMIT");
    expect(queue).toContain("CANVAS_QUEUE_SATURATED");
    expect(queue).toContain("CANVAS_RUNNER_UNAVAILABLE");
    expect(queue).toContain("canvas_worker_heartbeat_generation");
    expect(queue).toContain("canvas_worker_heartbeat_all");
    expect(queue).toMatch(/"status"\s+IN \('queued', 'running', 'cancel_requested', 'submission_unknown'\)/);
  });
});
