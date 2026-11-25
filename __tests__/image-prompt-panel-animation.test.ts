import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const imageToolSource = readFileSync(
  resolve(process.cwd(), "app/image/image-tool.tsx"),
  "utf8",
);
const referenceSource = readFileSync(
  resolve(process.cwd(), "components/ui/expandable-prompt-textarea.tsx"),
  "utf8",
);

function sourceBetween(source: string, start: string, end: string) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex);

  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);

  return source.slice(startIndex, endIndex);
}

describe("image prompt panel transition", () => {
  it("matches the instant final-size toggle used by custom batching", () => {
    const referenceOpen = sourceBetween(
      referenceSource,
      "const openPanel",
      "const closePanel",
    );
    const openPanel = sourceBetween(imageToolSource, "const openPromptPanel", "const closePromptPanel");
    const closePanel = sourceBetween(imageToolSource, "const closePromptPanel", "React.useEffect(() =>");
    const floatingPanel = sourceBetween(
      imageToolSource,
      "const expandedPromptPanel",
      "const activeReverseTask",
    );

    expect(referenceOpen).toContain("setPanelRect(clampRect({");
    expect(referenceOpen).toContain("setOpen(true)");
    expect(referenceOpen).not.toContain("requestAnimationFrame");
    expect(imageToolSource).not.toContain("PromptPanelPhase");
    expect(openPanel).toContain("setPromptPanelRect(targetRect)");
    expect(openPanel).toContain("setPromptPanelOpen(true)");
    expect(openPanel).not.toContain("requestAnimationFrame");
    expect(closePanel).toContain("setPromptPanelOpen(false)");
    expect(closePanel).toContain("setPromptPanelRect(null)");
    expect(closePanel).not.toContain("requestAnimationFrame");
    expect(floatingPanel).toContain("style={promptPanelRect}");
    expect(floatingPanel).not.toContain("onTransitionEnd");
    expect(floatingPanel).not.toContain("transition:");
  });
});
