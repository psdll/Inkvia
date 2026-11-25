import { readChineseUiSource as readFileSync } from "./helpers/chinese-ui-source";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(process.cwd(), "app/video/video-tool.tsx"), "utf8");

function sourceBetween(start: string, end: string) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex);

  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);

  return source.slice(startIndex, endIndex);
}

describe("video prompt editor parity", () => {
  it("uses the same single-layer prompt shell as the image editor", () => {
    const promptSection = sourceBetween("const promptSection = (", "const expandedPromptPanel");

    expect(promptSection).toContain('className="flex-1 min-h-0 flex flex-col"');
    expect(promptSection).toContain(
      'className="text-zinc-400 text-xs font-bold uppercase tracking-wider flex items-center justify-between gap-2 mb-2 flex-shrink-0"'
    );
    expect(promptSection).toContain("<RoleSkillTrigger");
    expect(promptSection).toContain("selected={Boolean(activeSelectedRoleSkillId)}");
    expect(promptSection).toContain('className="flex-1 min-h-0 relative"');
    expect(promptSection).toContain('<PromptEditorPortal target={promptEditorHost}>');
    expect(promptSection).toContain('renderPromptEditor(promptPanelOpen ? "h-full resize-none" : "w-full h-full resize-none", promptPanelOpen)');
    expect(promptSection).not.toContain("rounded-2xl border");
    expect(promptSection).not.toContain("shadow-[var(--shadow-2)]");
  });

  it("uses the same borderless right-angle expand corner as the image editor", () => {
    const promptSection = sourceBetween("const promptSection = (", "const expandedPromptPanel");
    const heading = sourceBetween(
      'className="text-zinc-400 text-xs font-bold uppercase tracking-wider',
      '<div ref={promptSourceRef}',
    );

    expect(heading).not.toContain("<button");
    expect(heading).not.toContain("<Maximize2");
    expect(promptSection).toContain("data-video-prompt-expand-corner");
    expect(promptSection).toContain("onClick={openPromptPanel}");
    expect(promptSection).toContain('aria-label="展开提示词"');
    expect(promptSection).toContain("absolute right-0 top-0");
    expect(promptSection).toContain("border-r border-t border-current");
    expect(promptSection).not.toContain("<Maximize2");
  });

  it("uses the image editor spacing in the expanded prompt panel", () => {
    const expandedPromptPanel = sourceBetween("const expandedPromptPanel", "const leftPanelContent");

    expect(expandedPromptPanel).toContain(
      '<div ref={setPromptEditorHost} className="h-full" />'
    );
    expect(source).toContain('contentClassName={expanded ? "pr-3 pb-12" : "pr-5 pb-12"}');
  });

  it("keeps the shared-history parameter dock aligned without a divider", () => {
    const sharedHistoryLayout = sourceBetween(
      "if (sharedHistory) {",
      '<div className="flex h-full gap-2.5">'
    );

    expect(sharedHistoryLayout).toContain(
      'className="flex-1 min-h-0 px-[clamp(14px,2.2dvh,20px)] pt-[clamp(14px,2.2dvh,20px)] pb-0"'
    );
    expect(sharedHistoryLayout).toContain(
      'className="relative z-20 mt-2 px-[clamp(14px,2.2dvh,20px)] pb-[clamp(14px,2.2dvh,20px)] pt-3"'
    );
    expect(sharedHistoryLayout).not.toContain("border-t border-[var(--border)]");
  });
});
