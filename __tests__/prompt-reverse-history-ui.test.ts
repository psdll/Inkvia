import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(process.cwd(), "app/image/image-tool.tsx"), "utf8");

describe("prompt reverse panel UI", () => {
  it("does not render the recent-task list", () => {
    expect(source).not.toContain("reverseTasks.slice(0, 8)");
    expect(source).not.toContain("selectPromptReverseTask");
    expect(source).not.toContain("formatPromptReverseTaskTime");
    expect(source).not.toContain("formatPromptReverseTaskStatus");
  });

  it("keeps generated Skill output inside the Skill panel", () => {
    expect(source).toContain("showApplyResult={false}");
    expect(source).toContain("onApplyResult={() => undefined}");
    expect(source).not.toContain("const applyReversePrompt");
  });
});
