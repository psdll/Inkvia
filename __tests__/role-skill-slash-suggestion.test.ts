import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import * as roleSkillCatalog from "@/hooks/use-role-skill-catalog";
import * as batchTypes from "@/components/batch-workbench/types";
import type { RoleSkillListItem } from "@/lib/role-skills/contracts";

function source(path: string) {
  try {
    return readFileSync(resolve(process.cwd(), path), "utf8");
  } catch {
    return "";
  }
}

const skills: RoleSkillListItem[] = [
  {
    id: "system:1",
    source: "system",
    name: "商品广告导演",
    summary: "生成商品广告画面",
    category: "营销",
    coverUrl: "/uploads/role_skill_covers/system/a.webp",
    usageScenario: "产品图与电商广告",
    usageGuide: "输入商品信息",
    mediaType: "image",
    revision: 1,
    createdAt: "2026-08-07T00:00:00.000Z",
    updatedAt: "2026-08-07T00:00:00.000Z",
  },
  {
    id: "personal:2",
    source: "personal",
    name: "人像精修",
    summary: "修复人物细节",
    category: "图片",
    coverUrl: null,
    usageScenario: "人物照片",
    usageGuide: "上传人物图片",
    mediaType: "image",
    revision: 1,
    createdAt: "2026-08-07T00:00:00.000Z",
    updatedAt: "2026-08-07T00:00:00.000Z",
  },
];

describe("role skill slash suggestions", () => {
  it("filters the shared skill catalog by slash query", () => {
    const filterRoleSkillSuggestions = (
      roleSkillCatalog as typeof roleSkillCatalog & {
        filterRoleSkillSuggestions?: (
          items: RoleSkillListItem[],
          query: string,
        ) => RoleSkillListItem[];
      }
    ).filterRoleSkillSuggestions;

    expect(filterRoleSkillSuggestions).toBeTypeOf("function");
    if (!filterRoleSkillSuggestions) return;

    expect(filterRoleSkillSuggestions(skills, "广告").map((skill) => skill.id)).toEqual([
      "system:1",
    ]);
    expect(filterRoleSkillSuggestions(skills, "人物").map((skill) => skill.id)).toEqual([
      "personal:2",
    ]);
    expect(filterRoleSkillSuggestions(skills, "")).toEqual(skills);
  });

  it("builds ordered @ reference assets from the custom batch product images", () => {
    const buildBatchPromptAssets = (
      batchTypes as typeof batchTypes & {
        buildBatchPromptAssets?: (
          media: batchTypes.BatchMediaRelation[],
        ) => Array<{ id: string; token: string; url?: string }>;
      }
    ).buildBatchPromptAssets;

    expect(buildBatchPromptAssets).toBeTypeOf("function");
    if (!buildBatchPromptAssets) return;

    const assets = buildBatchPromptAssets([
      {
        id: "relation-2",
        itemId: null,
        role: "product",
        position: 2,
        media: { id: "media-2", originalName: "second.png", publicUrl: "/second.png" },
      },
      {
        id: "relation-empty",
        itemId: null,
        role: "product",
        position: 1,
        media: { id: "media-empty" },
      },
      {
        id: "relation-1",
        itemId: null,
        role: "product",
        position: 0,
        media: { id: "media-1", originalName: "first.png", originalKey: "/first.png" },
      },
    ]);

    expect(assets).toEqual([
      { id: "batch-product-relation-1", token: "图片1", kind: "image", url: "/first.png", name: "first.png" },
      { id: "batch-product-relation-2", token: "图片2", kind: "image", url: "/second.png", name: "second.png" },
    ]);
  });

  it("uses one keyboard-accessible slash-only skill menu", () => {
    const editor = source("components/ui/prompt-rich-editor.tsx");
    const menu = source("components/role-skills/role-skill-slash-menu.tsx");
    const picker = source("components/role-skills/role-skill-picker.tsx");

    expect(editor).toContain('char: "/"');
    expect(editor).toContain('new PluginKey("assetMentionSuggestion")');
    expect(editor).toContain('new PluginKey("roleSkillSlashSuggestion")');
    expect(editor).toContain("pluginKey: assetMentionSuggestionPluginKey");
    expect(editor).toContain("pluginKey: roleSkillSlashSuggestionPluginKey");
    expect(editor).toContain("allow: ({ range, state }) =>");
    expect(editor).toContain("range.from === 1");
    expect(editor).toContain("state.doc.resolve(range.from).parentOffset === 0");
    expect(editor).toContain("deleteRange(range)");
    expect(editor).toContain("RoleSkillSlashMenu");
    expect(menu).toContain('data-role-skill-slash-menu=""');
    expect(menu).toContain('role="dialog"');
    expect(menu).toContain("<RoleSkillPicker");
    expect(picker).toContain('role="listbox"');
    expect(picker).toContain('role="option"');
    expect(menu).toContain('event.key === "ArrowDown"');
    expect(menu).toContain('event.key === "ArrowUp"');
    expect(menu).toContain('event.key === "Enter"');
    expect(menu).toContain('onCreate={() => props.onOpenLibrary("create")}');
    expect(menu).toContain('onView={(skill) => props.onOpenLibrary("detail", skill)}');
  });

  it("connects the same rich editor to image editing and custom batch mode", () => {
    const imageTool = source("app/image/image-tool.tsx");
    const batchSettings = source("components/batch-workbench/batch-settings-panel.tsx");
    const expandableEditor = source("components/ui/expandable-prompt-textarea.tsx");

    expect(imageTool).toContain("roleSkills={roleSkills}");
    expect(imageTool).toContain("onRoleSkillSelect={selectToolboxRoleSkill}");
    expect(imageTool).toContain("selectedRoleSkill={toolboxRoleSkill}");
    expect(imageTool).toContain("onRoleSkillRemove={clearToolboxRoleSkillSelection}");
    expect(expandableEditor).toContain("<PromptRichEditor");
    expect(batchSettings).toContain("assets={batchPromptAssets}");
    expect(batchSettings).toContain("roleSkills={batch.mode === \"multi_prompt\" ? roleSkills : []}");
    expect(batchSettings).toContain("onRoleSkillSelect={batch.mode === \"multi_prompt\"");
    expect(batchSettings).toContain("selectedRoleSkill={batch.mode === \"multi_prompt\"");
    expect(batchSettings).toContain("onRoleSkillRemove={batch.mode === \"multi_prompt\"");
  });
});
