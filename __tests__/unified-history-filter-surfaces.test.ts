import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(process.cwd(), "components/history/unified-history-actions.tsx"), "utf8");
const styles = readFileSync(resolve(process.cwd(), "app/globals.css"), "utf8");

describe("unified history filter surfaces", () => {
  it("uses the shared dropdown trigger surface for task progress", () => {
    expect(source).toContain('bg-[var(--input-bg)]');
    expect(source).toContain('shadow-[var(--shadow-2)]');
    expect(source).toContain('hover:bg-[var(--panel-2)]');
  });

  it("uses the shared dropdown panel surface for task progress", () => {
    expect(source).toContain('select-dropdown-panel task-progress-popover');
    expect(styles).not.toContain(".task-progress-trigger");
    expect(styles).not.toContain(".task-progress-popover");
  });
});
