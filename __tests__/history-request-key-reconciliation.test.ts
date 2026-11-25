import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("history request-key reconciliation", () => {


  it("reconciles optimistic and persisted items by submission identity instead of timestamps", () => {
    const panel = read("components/history/unified-history-panel.tsx");

    expect(panel).toContain("isSameSubmissionBatchTask(item, incoming)");
    expect(panel).not.toContain("pendingCreatedAt > nextCreatedAt");
    expect(panel).not.toContain("realCreatedTimes");
  });
});
