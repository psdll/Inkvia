import { readChineseUiSource as readFileSync } from "./helpers/chinese-ui-source";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const historySource = readFileSync(
  resolve(process.cwd(), "components/history/unified-history-panel.tsx"),
  "utf8",
);
const globalStyles = readFileSync(resolve(process.cwd(), "app/globals.css"), "utf8");

function sourceBetween(source: string, start: string, end: string) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex);

  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);

  return source.slice(startIndex, endIndex);
}

describe("history generation animation", () => {
  it("reuses one indicator for the image and video pending views", () => {
    const pendingView = sourceBetween(
      historySource,
      "{isGenerating && !hasDisplayOutput && !hasGroupDisplay ? (",
      ") : hasDisplayOutput || hasGroupDisplay ? (",
    );
    const indicatorUses = pendingView.match(/<HistoryGeneratingIndicator\b/g) || [];

    expect(indicatorUses).toHaveLength(2);
    expect(pendingView).not.toContain("border-[2.5px]");
    expect(pendingView).not.toContain("spin-smooth");
    expect(pendingView).not.toContain("float-y");
    expect(pendingView).not.toContain("breathe");
  });

  it("restores the logo and keeps generation text below it without a spinner", () => {
    const indicator = sourceBetween(historySource, "function HistoryGeneratingIndicator", "export type UnifiedHistoryPanelHandle");

    expect(indicator).toContain('className="history-generating-indicator__label">生成中</span>');
    expect(indicator).toContain('src="/favicon.png"');
    expect(indicator).toContain('className="history-generating-indicator__grid"');
    expect(indicator).toContain('className="history-generating-indicator__corners"');
    expect(indicator).not.toContain("<svg");
    expect(historySource.match(/<HistoryGeneratingIndicator size="thumbnail" \/>/g)).toHaveLength(2);
  });

  it("does not render a blurred haze behind the generation indicator", () => {
    const indicator = sourceBetween(historySource, "function HistoryGeneratingIndicator", "export type UnifiedHistoryPanelHandle");

    expect(indicator).not.toContain("bg-blue-500/10 blur-2xl");
  });

  it("does not render a blurred red haze behind image or video failure indicators", () => {
    expect(historySource).not.toContain("bg-rose-500/10 blur-2xl");
  });

  it("keeps moving light behind static text and respects reduced motion", () => {
    const light = sourceBetween(globalStyles, ".history-generating-indicator__sweep {", ".history-generating-indicator__corners {");
    const content = sourceBetween(globalStyles, ".history-generating-indicator__content {", ".history-generating-indicator__logo {");
    expect(light).toContain("animation: history-generating-sweep 4.2s linear infinite;");
    expect(content).toContain("z-index: 1;");
    expect(content).not.toContain("animation:");
    expect(globalStyles).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{\s*\.history-generating-indicator__sweep\s*\{\s*animation:\s*none;/);
  });
});
