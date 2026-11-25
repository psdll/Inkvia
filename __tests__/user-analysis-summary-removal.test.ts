import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const panelSource = readFileSync(resolve(process.cwd(), "components/admin/UserAnalysisPanel.tsx"), "utf8");

describe("user analysis duplicate summary removal", () => {
  it("does not render the legacy summary-card grid below the relationship graph", () => {
    expect(panelSource).not.toContain("<SummaryCard");
    expect(panelSource).not.toContain("function SummaryCard");
  });
});
