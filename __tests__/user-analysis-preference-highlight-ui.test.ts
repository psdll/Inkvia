import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const panelSource = readFileSync(resolve(process.cwd(), "components/admin/UserAnalysisPanel.tsx"), "utf8");

describe("user analysis preference-flow highlighting", () => {
  it("uses the shared accent token to surface dominant nodes and ribbons", () => {
    expect(panelSource).toContain("dominantNodeIds");
    expect(panelSource).toContain("dominantRibbonIds");
    expect(panelSource).toContain("color-mix(in srgb, var(--primary-bg)");
    expect(panelSource).toContain("bg-[var(--primary-bg)]/10");
  });

  it("reveals a related path for pointer and keyboard focus", () => {
    expect(panelSource).toContain("const [activeNodeId");
    expect(panelSource).toContain("activePathNodeIds");
    expect(panelSource).toContain("activePathRibbonIds");
    expect(panelSource).toContain("onMouseEnter={() => setActiveNodeId(node.id)}");
    expect(panelSource).toContain("onFocus={() => setActiveNodeId(node.id)}");
    expect(panelSource).toContain("tabIndex={0}");
    expect(panelSource).toContain("motion-reduce:transition-none");
  });

  it("keeps complete wrapped labels inside a chart that grows with the real label count", () => {
    expect(panelSource).toContain("labelLines: string[]");
    expect(panelSource).toContain("function wrapFlowLabel");
    expect(panelSource).toContain("function preferenceFlowNodeMinHeight");
    expect(panelSource).toContain("function fitPreferenceFlowHeights");
    expect(panelSource).toContain("PREFERENCE_FLOW_LABEL_LINE_HEIGHT = 12");
    expect(panelSource).toContain("function preferenceFlowChartHeight");
    expect(panelSource).toContain('viewBox={`0 0 1104 ${layout.chartHeight}`}');
    expect(panelSource).toContain("<tspan");
    expect(panelSource).not.toContain("shortFlowLabel");
    expect(panelSource).toContain("layout.chartHeight");
  });
});
