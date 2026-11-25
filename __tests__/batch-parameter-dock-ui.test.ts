import { readChineseUiSource as readFileSync } from "./helpers/chinese-ui-source";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("style replication parameter dock", () => {
  it("keeps the scrolling content separate from the fixed bottom actions", () => {
    const settings = read(
      "components/batch-workbench/batch-settings-panel.tsx",
    );

    expect(settings).toContain("min-h-0 flex-1 flex-col overflow-y-auto p-4 pb-0");
    expect(settings).toContain("const groupedWorkflow = isGroupedImageBatchMode(batch.mode)");
    expect(settings).toContain("shrink-0 space-y-3");
    expect(settings).toContain("<BatchParameterDock");
    expect(settings.indexOf("<BatchParameterDock")).toBeLessThan(
      settings.indexOf("<GenerateActionButton"),
    );
  });

  it("does not draw a divider above the fixed bottom actions", () => {
    const settings = read(
      "components/batch-workbench/batch-settings-panel.tsx",
    );

    expect(settings).not.toContain("shrink-0 space-y-3 border-t");
  });

  it("labels the fixed controls as generation parameters", () => {
    const settings = read(
      "components/batch-workbench/batch-settings-panel.tsx",
    );

    expect(settings).toContain("生成参数");
    expect(settings.indexOf("生成参数")).toBeLessThan(
      settings.indexOf("<BatchParameterDock"),
    );
  });

  it("matches the image editor two-part dock without a quantity control", () => {
    const dock = read("components/batch-workbench/batch-parameter-dock.tsx");

    expect(dock).toContain("grid-cols-[minmax(0,1fr)_1px_minmax(0,1fr)]");
    expect(dock).toContain('"model" | "params" | null');
    expect(dock).toMatch(/renderOptionGrid\(\s*isQwenImage3Model\(model\) \? "清晰度" : "分辨率"/);
    expect(dock).toMatch(/renderOptionGrid\(\s*"比例"/);
    expect(dock).not.toContain("quantity");
    expect(dock).not.toContain("outputQuantity");
  });

  it("keeps both popovers inside the left panel and preserves manual model scrolling", () => {
    const dock = read("components/batch-workbench/batch-parameter-dock.tsx");

    expect(dock).toContain("modelPanelAutoScrolledRef");
    expect(dock).toContain("if (modelPanelAutoScrolledRef.current) return");
    expect(dock).toContain("dockRect?.width");
    expect(dock).toContain("dockRect?.left");
  });

  it("uses the original themed panel background and scrollable model summary", () => {
    const dock = read("components/batch-workbench/batch-parameter-dock.tsx");

    expect(dock).not.toContain("solid-panel-surface");
    expect(dock).toContain("bg-[var(--panel-bg)]");
    expect(dock).toContain("overflow-x-auto whitespace-nowrap");
    expect(dock).not.toMatch(
      /className="min-w-0 flex-1 truncate">\s*\{selectedModel/,
    );
  });

  it("keeps the group-header triggers joined while separating their panels", () => {
    const dock = read("components/batch-workbench/batch-parameter-dock.tsx");

    expect(dock).toContain('variant?: "default" | "groupHeader"');
    expect(dock).toContain('variant = "default"');
    expect(dock).toContain('const groupHeader = variant === "groupHeader"');
    expect(dock).toContain('groupHeader ? "切换模型" : selectedModel?.label || model');
    expect(dock).toContain('aria-label="修改整组参数"');
    expect(dock).toContain("SlidersHorizontal");
    expect(dock).not.toContain('openPanel === "group"');
    expect(dock).toContain("top: rect.bottom + 10");
    expect(dock).toContain("if (disabled) setOpenPanel(null)");
  });
});
