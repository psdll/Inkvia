import { readChineseUiSource as readFileSync } from "./helpers/chinese-ui-source";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const imageToolSource = readFileSync(resolve(process.cwd(), "app/image/image-tool.tsx"), "utf8");
const videoToolSource = readFileSync(resolve(process.cwd(), "app/video/video-tool.tsx"), "utf8");
const batchDockSource = readFileSync(resolve(process.cwd(), "components/batch-workbench/batch-parameter-dock.tsx"), "utf8");
const globalsSource = readFileSync(resolve(process.cwd(), "app/globals.css"), "utf8");
const themeSource = readFileSync(resolve(process.cwd(), "styles/theme-system.css"), "utf8");

describe("image parameter dock theme", () => {
  it("labels the expanded model panel before its options", () => {
    const start = imageToolSource.indexOf('{parameterPanelOpen === "model" ? (');
    const options = imageToolSource.indexOf("{modelOptions.map", start);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(options).toBeGreaterThan(start);

    const modelPanel = imageToolSource.slice(start, options);

    expect(modelPanel).toContain(
      'className="text-[12px] font-semibold text-[var(--app-fg)]/90">模型</div>',
    );
    expect(modelPanel).toContain("ref={parameterModelListRef}");
  });

  it("uses the shared #202020 panel background in dark mode", () => {
    const start = imageToolSource.indexOf("const footerContent = (");
    const end = imageToolSource.indexOf("if (sharedHistory)", start);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);

    const footerContent = imageToolSource.slice(start, end);

    expect(footerContent).toContain("dark:bg-[var(--panel-bg)]");
    expect(footerContent).not.toContain("dark:bg-[#202124]");
    expect(themeSource).toContain("--color-bg-card: #202020;");
    expect(themeSource).toContain("--panel-bg: var(--color-bg-card);");
  });

  it("uses the batch workbench panel surface for both image parameter popovers", () => {
    const start = imageToolSource.indexOf("const parameterFloatingPanel");
    const end = imageToolSource.indexOf("const footerContent", start);
    const parameterFloatingPanel = imageToolSource.slice(start, end);

    expect(batchDockSource).toContain("bg-[var(--panel-bg)]");
    expect(parameterFloatingPanel).toContain("bg-[var(--panel-bg)]");
    expect(parameterFloatingPanel).not.toContain("solid-panel-surface");
    expect(parameterFloatingPanel).not.toContain("bg-[var(--sidebar-bg)]");
    expect(parameterFloatingPanel).toContain('parameterPanelOpen === "model"');
    expect(parameterFloatingPanel).toContain("renderParameterPanelBody()");
    expect(imageToolSource).toContain('React.useState<"model" | "params" | null>(null)');
    expect(parameterFloatingPanel).not.toContain('parameterPanelOpen === "quantity"');
  });

  it("places quantity at the bottom of the expanded parameter panel instead of the footer dock", () => {
    const panelStart = imageToolSource.indexOf("const renderParameterPanelBody");
    const panelEnd = imageToolSource.indexOf("const parameterFloatingPanel", panelStart);
    const parameterPanel = imageToolSource.slice(panelStart, panelEnd);
    const footerStart = imageToolSource.indexOf("const footerContent = (");
    const footerEnd = imageToolSource.indexOf("if (sharedHistory)", footerStart);
    const footerContent = imageToolSource.slice(footerStart, footerEnd);

    const aspectRatioIndex = parameterPanel.indexOf('renderParamGrid("比例"');
    const quantityIndex = parameterPanel.indexOf('"数量",');

    expect(aspectRatioIndex).toBeGreaterThanOrEqual(0);
    expect(quantityIndex).toBeGreaterThan(aspectRatioIndex);
    expect(parameterPanel.slice(quantityIndex)).not.toContain("renderParamGrid(");
    expect(imageToolSource).toContain("const IMAGE_OUTPUT_QUANTITIES = [1, 2, 4] as const;");
    expect(parameterPanel).toContain("IMAGE_OUTPUT_QUANTITIES.map(");
    expect(parameterPanel.slice(quantityIndex)).toContain("{ columns: 3 }");
    expect(parameterPanel).not.toContain("Array.from({ length: 10 }");
    expect(imageToolSource).toContain("normalizeOutputQuantity(parsed.outputQuantity)");
    expect(imageToolSource).toContain("normalizeOutputQuantity(state.outputQuantity)");
    expect(footerContent).not.toContain("parameterQuantityButtonRef");
    expect(footerContent).not.toContain("outputQuantity}张");
  });

  it("shows the selected quantity in the compact parameter summary", () => {
    const summaryStart = imageToolSource.indexOf("const parameterSummary");
    const summaryEnd = imageToolSource.indexOf("const selectedAspectRatioOption", summaryStart);
    const parameterSummary = imageToolSource.slice(summaryStart, summaryEnd);

    expect(parameterSummary).toContain("isMidjourneyV8Selected");
    expect(parameterSummary).toContain('[midjourneySpeed]) + (midjourneyOptions.hd ? " · HD" : "") + " · " + imageCountLabel(4)');
    expect(parameterSummary).toContain(') + " · " + imageCountLabel(outputQuantity);');
  });

  it("keeps the video parameter panel on the same shared panel background", () => {
    const videoPanelStart = videoToolSource.indexOf("const renderSeedanceParameterPanel");
    const videoPanelEnd = videoToolSource.indexOf("const promptPlaceholder", videoPanelStart);
    const videoPanel = videoToolSource.slice(videoPanelStart, videoPanelEnd);
    const darkRuleStart = globalsSource.indexOf("html.dark .video-param-panel");
    const darkRuleEnd = globalsSource.indexOf("}", darkRuleStart);
    const darkRule = globalsSource.slice(darkRuleStart, darkRuleEnd);

    expect(videoPanel).toContain("bg-[var(--panel-bg)]");
    expect(darkRule).toContain("background-color: var(--panel-bg) !important;");
    expect(darkRule).not.toContain("background-color: #101113");
  });
});
