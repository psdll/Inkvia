import { verifyPresetTrigger } from './helpers/canvas-ui-contract-harness';
import { existsSync } from "node:fs";
import { readChineseUiSource as readFileSync } from "./helpers/chinese-ui-source";
import { describe, expect, it } from "vitest";

const read = (path: string) => {
  expect(existsSync(path), `${path} must exist`).toBe(true);
  return readFileSync(path, "utf8");
};

describe("batch workbench prompt presets", () => {
  it("places the shared preset trigger inside the prompt field", () => {
    const settings = read(
      "components/batch-workbench/batch-settings-panel.tsx",
    );

    expect(settings).toContain("PresetPromptsTrigger");
    expect(settings).not.toContain('scope="image_batch"');
    expect(settings).not.toMatch(/<PresetPromptsTrigger[\s\S]*?\buserId=/);
    expect(settings).not.toContain('presentation="assistant"');
    expect(settings).toContain('mode="inline"');
    expect(settings).toContain('triggerLabel="预设提示词"');
    expect(settings).toContain(
      'className="absolute right-3 bottom-3 !h-6 !gap-1 !rounded-md !px-1.5 !py-1 !text-[10px] [&_svg]:!h-3 [&_svg]:!w-3"',
    );
    expect(settings).not.toContain("!pb-10");
    expect(settings).toContain(
      "onApply={(content) => onBatchChange({ sharedPrompt: content })}",
    );
  });

  it("uses one preset prompt label and icon across workspaces", async () => {

    const trigger = read("components/presets/preset-prompts.tsx");
    const imageTool = read("app/image/image-tool.tsx");
    const videoTool = read("app/video/video-tool.tsx");

    const canvasNode = read("components/canvas/CanvasNodeCard.tsx");

    expect(trigger).toContain('triggerLabel === undefined || triggerLabel === "预设提示词" ? "预设提示词" : triggerLabel');
    expect(trigger).toContain('<MessageSquareText className="h-3.5 w-3.5" />');
    expect(trigger).toContain("aria-label={displayTriggerLabel}");
    expect(trigger).toContain("title={displayTriggerLabel}");
    expect(trigger).toContain("text-[var(--app-muted)]");
    expect(trigger).toContain("hover:text-[var(--app-fg)]");
    expect(trigger).not.toContain("text-violet");
    expect(trigger).not.toContain("bg-violet");
    expect(imageTool).toContain('triggerLabel="预设提示词"');
    expect(videoTool).toContain('triggerLabel="预设提示词"');


      for (const kind of ["imageTask", "videoTask"]) await verifyPresetTrigger(kind);
  });

  it("builds custom category tabs from saved prompts", () => {
    const assistant = read("components/presets/preset-prompts.tsx");

    expect(assistant).toContain("提示词助手");
    expect(assistant).toContain("搜索标题、分类或内容...");
    expect(assistant).toContain("新建提示词");
    expect(assistant).toContain("assistantCategories");
    expect(assistant).toContain("assistantCategories.map");
    expect(assistant).toContain('placeholder="输入或新建分组"');
    expect(assistant).not.toContain("PROMPT_ASSISTANT_CATEGORIES");
    expect(assistant).toContain("编辑提示词");
    expect(assistant).toContain("提示词内容");
  });

  it("uses a compact assistant and editor layout", () => {
    const assistant = read("components/presets/preset-prompts.tsx");

    expect(assistant).toContain("max-w-[680px]");
    expect(assistant).toContain("h-[min(500px,72vh)]");
    expect(assistant).toContain("max-w-[500px]");
    expect(assistant).toContain("min-h-[180px]");
  });

  it("applies a prompt by replacing the field and then closes the assistant", () => {
    const assistant = read("components/presets/preset-prompts.tsx");

    expect(assistant).toMatch(/onApply\(p\.content\);\s*setOpen\(false\);/);
    expect(assistant).toContain("event.stopPropagation()");
  });

  it("clamps long preset card previews without truncating prompt actions", () => {
    const assistant = read("components/presets/preset-prompts.tsx");

    expect(assistant).toContain("line-clamp-4");
    expect(assistant).toMatch(/onApply\(p\.content\);\s*setOpen\(false\);/);
    expect(assistant).toContain("copyText(p.content)");
    expect(assistant).toContain("openEdit(p)");
  });

  it("requires a free-text category for creates and edits", () => {
    const assistant = read("components/presets/preset-prompts.tsx");

    expect(assistant).toContain('placeholder="输入或新建分组"');
    expect(assistant).toContain("const groupErr = !group");
    expect(assistant).toContain("if (groupErr || nErr || cErr) return");
    expect(assistant).not.toContain("<select");
  });
});
