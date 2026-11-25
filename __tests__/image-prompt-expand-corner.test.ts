import { readChineseUiSource as readFileSync } from "./helpers/chinese-ui-source";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const imageToolSource = readFileSync(resolve(process.cwd(), "app/image/image-tool.tsx"), "utf8");
const editorSource = readFileSync(resolve(process.cwd(), "components/ui/prompt-rich-editor.tsx"), "utf8");
const roleSkillTriggerSource = readFileSync(resolve(process.cwd(), "components/role-skills/role-skill-trigger.tsx"), "utf8");

function sourceBetween(source: string, start: string, end: string) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex);

  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);

  return source.slice(startIndex, endIndex);
}

describe("image prompt expand corner", () => {
  it("removes the expand action from the prompt heading", () => {
    const heading = sourceBetween(
      imageToolSource,
      'className="text-zinc-400 text-xs font-bold uppercase tracking-wider',
      '<div ref={promptSourceRef}',
    );

    expect(heading).toContain("<RoleSkillTrigger");
    expect(roleSkillTriggerSource).toContain("技能");
    expect(roleSkillTriggerSource).toContain('title="技能 / Skill"');
    expect(heading).not.toContain("onClick={openPromptPanel}");
    expect(heading).not.toContain("data-prompt-expand-corner");
    expect(heading).not.toContain("<Maximize2");
  });

  it("keeps the expand action as a borderless right-angle corner inside the editor", () => {
    const mainContent = sourceBetween(imageToolSource, "const mainContent = (", "const expandedPromptPanel");

    expect(mainContent).toContain("data-prompt-expand-corner");
    expect(mainContent).toContain("onClick={openPromptPanel}");
    expect(mainContent).toContain('aria-label="展开提示词"');
    expect(mainContent).toContain('<PromptEditorPortal target={promptEditorHost}>');
    expect(mainContent).toContain('renderPromptEditor(promptPanelOpen ? "h-full resize-none" : "w-full h-full resize-none", promptPanelOpen)');
    expect(imageToolSource).toContain('contentClassName={expanded ? "pr-3 pb-12" : "pr-5 pb-12"}');
    expect(mainContent).toContain("absolute right-0 top-0");
    expect(mainContent).toContain("border-r border-t border-current");
    expect(mainContent).not.toContain("<Maximize2");
  });

  it("does not change the prompt editor border treatment", () => {
    expect(editorSource).toContain(
      "rounded-lg border border-[var(--border)] bg-[var(--input-bg)] focus-within:border-blue-500/40 focus-within:ring-1 focus-within:ring-blue-500/30",
    );
  });
});
