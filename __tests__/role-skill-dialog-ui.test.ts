import fs from "node:fs";
import { readChineseUiSource } from "./helpers/chinese-ui-source";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { formatRoleSkillPreviewMarkdown } from "@/components/role-skills/role-skill-detail-view";

function source(file: string) {
  return readChineseUiSource(path.join(process.cwd(), file), "utf8");
}

describe("shared role skill dialog contract", () => {
  it("opens the system catalog, favorites, and personal skills beside the existing result slot", () => {
    const dialog = source("components/role-skills/role-skill-dialog.tsx");
    expect(dialog).toMatch(/onClick=\{\(\) => switchSource\("system"\)\}[\s\S]+?>\s*Skill\s*<\/button>/);
    expect(dialog).toContain('{ value: "favorites", label: "收藏" }');
    expect(dialog).toContain('{ value: "personal", label: "我的" }');
    expect(dialog).toContain("搜索技能");
    expect(dialog).toContain("当前使用");
    expect(dialog).toContain("生成结果");
    expect(dialog).not.toContain("LLM 生成结果");
    expect(dialog).toContain("props.result");
    expect(dialog).toContain("创建技能");
    expect(dialog).toContain("结果来自上一次技能");
  });

  it("offers an optional clear action without changing callers that do not provide it", () => {
    const dialog = source("components/role-skills/role-skill-dialog.tsx");
    expect(dialog).toContain("onClearSelection?(): void");
    expect(dialog).toContain("取消使用");
    expect(dialog).toContain("props.onClearSelection");
  });

  it("loads both Skill sources for viewing while keeping mutations personal-only", () => {
    const dialog = source("components/role-skills/role-skill-dialog.tsx");
    const card = source("components/role-skills/role-skill-card.tsx");
    const detail = source("components/role-skills/role-skill-detail-view.tsx");
    expect(dialog).toContain('skill.source === "personal"');
    expect(dialog).toContain("getPersonalRoleSkillClient");
    expect(dialog).toContain("getSystemRoleSkillClient");
    expect(dialog).toContain("onView={() => void openDetail(skill)}");
    expect(dialog).toContain('onEdit={detailState.skill.source === "personal"');
    expect(dialog).toContain('onDelete={detailState.skill.source === "personal"');
    expect(card).toContain("详情");
    expect(card).not.toContain("编辑");
    expect(detail).toMatch(/onClick=\{onEdit\}[^>]*>.*编辑<\/button>/);
    expect(card).not.toContain('label="复制"');
    expect(dialog).not.toContain("copyPersonalRoleSkillClient");
    expect(detail).toMatch(/onClick=\{onDelete\}[^>]*>.*删除<\/button>/);
  });

  it("uses one shared cover Skill card across user and administrator lists", () => {
    const dialog = source("components/role-skills/role-skill-dialog.tsx");
    const userPanel = source("components/admin/UserRoleSkillsPanel.tsx");
    const systemPanel = source("components/admin/SystemRoleSkillsPanel.tsx");

    expect(dialog).toContain("<RoleSkillCard");
    expect(userPanel).toContain("<RoleSkillCard");
    expect(systemPanel).toContain("<RoleSkillCard");
    expect(userPanel).toContain("grid-cols-[repeat(auto-fill,minmax(min(100%,180px),1fr))]");
    expect(systemPanel).toContain("grid-cols-[repeat(auto-fill,minmax(min(100%,180px),1fr))]");
  });

  it("states that deleting a personal Skill cannot be undone", () => {
    const dialog = source("components/role-skills/role-skill-dialog.tsx");

    expect(dialog).toContain("个人技能删除后无法恢复");
  });

  it("keeps system, favorites, and personal sources distinct without an all-source choice", () => {
    const dialog = source("components/role-skills/role-skill-dialog.tsx");
    const card = source("components/role-skills/role-skill-card.tsx");
    const detail = source("components/role-skills/role-skill-detail-view.tsx");

    expect(dialog).toContain('React.useState<"system" | "favorites" | "personal">("system")');
    expect(dialog).not.toContain('value: "all"');
    expect(dialog).not.toContain('["全部",');
    expect(dialog).toContain("const activeCategory =");
    expect(card).not.toContain('{personal ? "我的" : "系统"}');
    expect(card).toContain('skill.source === "system" ? "官方" : skill.ownerName');
    expect(detail).not.toContain("我的 Skill");
    expect(dialog).not.toContain(
      '{selectedSkill.source === "system" ? "系统" : "我的"}',
    );
  });

  it("marks the selected Skill card as current and uses the test action copy", () => {
    const dialog = source("components/role-skills/role-skill-dialog.tsx");
    const card = source("components/role-skills/role-skill-card.tsx");

    expect(dialog).toContain(
      "selected={skill.id === props.selectedRoleSkillId}",
    );
    expect(card).toContain('aria-pressed={onSelect ? selected : undefined}');
    expect(card).toContain('selected ? "ring-2 ring-inset');
    expect(dialog).toContain('props.generating ? "生成中..." : "测试Skill"');
    expect(dialog).not.toContain("使用此 Skill 生成");
  });

  it("keeps the personal Skill title fixed above one scrolling detail body", () => {
    const dialog = source("components/role-skills/role-skill-dialog.tsx");
    const detailPath = path.join(
      process.cwd(),
      "components/role-skills/role-skill-detail-view.tsx",
    );

    expect(fs.existsSync(detailPath)).toBe(true);
    if (!fs.existsSync(detailPath)) return;

    const detail = source("components/role-skills/role-skill-detail-view.tsx");
    const sharedView = source(
      "components/role-skills/role-skill-content-view.tsx",
    );
    expect(dialog).toContain("<RoleSkillDetailView");
    expect(detail).toContain("简介");
    expect(detail).toContain("getSkillWorkspaceBaseName(selectedFile.path)");
    expect(detail).toContain("<SkillWorkspaceFilePicker");
    expect(source("components/role-skills/skill-workspace-file-picker.tsx")).toContain("选择 Skill 文件");
    expect(sharedView).toContain("格式化预览");
    expect(sharedView).toContain("原始 Markdown");
    expect(detail).toContain('React.useState<"preview" | "source">("preview")');
    expect(detail).toContain("virtuosoRef.current?.scrollToIndex");
    expect(detail).toContain("flex min-h-0 flex-1 flex-col");
    expect(detail).toContain("shrink-0");
    expect(detail).toContain("role-skill-detail-scrollbar");
    expect(detail.indexOf("</header>")).toBeLessThan(
      detail.indexOf("role-skill-detail-scrollbar"),
    );
    expect(detail).not.toContain("max-w-5xl");
    expect(detail).not.toContain("divide-y");
    expect(detail).not.toContain("sticky");
  });

  it("opens Skill details at the first item instead of scrolling into the middle", () => {
    const detail = source("components/role-skills/role-skill-detail-view.tsx");
    const scrollToTopCalls = detail.match(
      /scrollToIndex\(\{ index: 0, align: "start" \}\)/g,
    );

    expect(scrollToTopCalls).toHaveLength(2);
    expect(detail).not.toContain(
      'scrollToIndex({ index: 1, align: "start" })',
    );
  });

  it("uses compact spacing for the Skill introduction metadata", () => {
    const detail = source("components/role-skills/role-skill-detail-view.tsx");

    expect(detail).toContain('className="pt-4"');
    expect(detail).toContain('<dl className="mt-2">');
    expect(detail).toContain(
      'className="grid gap-2 py-2 text-sm sm:grid-cols-[84px_minmax(0,1fr)] sm:gap-3"',
    );
    expect(detail).toContain(
      'className="whitespace-pre-wrap leading-5 font-medium text-[var(--app-fg)]"',
    );
  });

  it("uses a local wide scrollbar with visible arrow controls", () => {
    const detail = source("components/role-skills/role-skill-detail-view.tsx");
    const styles = source("app/globals.css");

    expect(detail).toContain("ChevronUp");
    expect(detail).toContain("ChevronDown");
    expect(detail).toContain('aria-label="向上滚动 Skill 内容"');
    expect(detail).toContain('aria-label="向下滚动 Skill 内容"');
    expect(styles).toContain(".role-skill-detail-scrollbar::-webkit-scrollbar");
    expect(styles).toContain("width: 20px");
    expect(styles).toContain("margin-block: 20px");
    expect(styles).toContain("background: var(--role-skill-scrollbar-track)");
    expect(styles).toContain("background: var(--role-skill-scrollbar-thumb)");
  });

  it("offers distinct read-only formatted and raw Markdown views with strong headings", () => {
    const detail = source("components/role-skills/role-skill-detail-view.tsx");
    const sharedView = source(
      "components/role-skills/role-skill-content-view.tsx",
    );

    expect(sharedView).toContain('variant = "viewer"');
    expect(sharedView).toContain('editorVariant ? "预览" : "格式化预览"');
    expect(sharedView).toContain('editorVariant ? "代码" : "原始 Markdown"');
    expect(sharedView).toContain("aria-pressed={active}");
    expect(detail).toContain('visibleFormat === "preview"');
    expect(detail).toContain("<RoleSkillFormattedChunk");
    expect(detail).toContain("<RoleSkillContentFormatToggle");
    expect(sharedView).toContain("<Markdown");
    expect(detail).toContain("<RoleSkillSourceContent content={item.content}");
    expect(detail).toContain("text-[var(--app-fg)] sm:text-2xl");
    expect(sharedView).toContain(
      "text-2xl font-bold leading-tight text-[var(--app-fg)]",
    );
    expect(detail).toContain(
      "whitespace-pre-wrap leading-5 font-medium text-[var(--app-fg)]",
    );
    expect(sharedView).toContain(
      "font-mono text-[13px] leading-6 text-[var(--app-muted)]",
    );
    expect(detail).not.toContain("<textarea");
    expect(detail).not.toContain("contentEditable");
  });

  it("protects system Skill content in the user dialog but not administrator details", () => {
    const dialog = source("components/role-skills/role-skill-dialog.tsx");
    const detail = source("components/role-skills/role-skill-detail-view.tsx");
    const adminDetail = source(
      "components/role-skills/role-skill-detail-dialog.tsx",
    );

    expect(detail).toContain("protectContent = false");
    expect(detail).toContain("const contentProtected = protectContent");
    expect(detail).toContain('contentProtected ? "select-none" : ""');
    expect(detail).toContain(
      "onCopy={contentProtected ? preventContentTransfer : undefined}",
    );
    expect(detail).toContain(
      "onCut={contentProtected ? preventContentTransfer : undefined}",
    );
    expect(detail).toContain(
      "onDragStart={contentProtected ? preventContentTransfer : undefined}",
    );
    expect(dialog).toContain(
      'protectContent={detailState.skill.source === "system"}',
    );
    expect(adminDetail).toContain("<RoleSkillDetailView skill={skill} onClose={onClose} downloadAction={downloadAction}");
    expect(adminDetail).not.toContain("protectContent=");
  });

  it("keeps plain Skill content as body text unless Markdown headings are explicit", () => {
    const plain = [
      "按摩椅AI图片素材提示词总控系统",
      "一、角色身份",
      "正文保持原样。",
      "二、核心视觉定位",
    ].join("\n");

    expect(formatRoleSkillPreviewMarkdown(plain)).toBe(plain);
    expect(formatRoleSkillPreviewMarkdown("# 已有标题\n## 已有章节")).toBe(
      "# 已有标题\n## 已有章节",
    );
  });

  it("uses the reference frame size only for the read-only detail", () => {
    const dialog = source("components/role-skills/role-skill-dialog.tsx");

    expect(dialog).toContain('"h-[min(940px,92vh)] w-[min(1080px,96vw)]"');
    expect(dialog).toContain(': "h-[min(820px,92vh)] w-[min(1280px,96vw)]"');
  });

  it("opens the Skill detail loading view before awaiting its request", () => {
    const dialog = source("components/role-skills/role-skill-dialog.tsx");
    const detail = source("components/role-skills/role-skill-detail-view.tsx");
    const openDetailStart = dialog.indexOf("const openDetail");
    const openDetailEnd = dialog.indexOf("const openPersonal", openDetailStart);
    const openDetail = dialog.slice(openDetailStart, openDetailEnd);

    expect(openDetail).toContain("setDetailState({ skill, loading: true })");
    expect(
      openDetail.indexOf("setDetailState({ skill, loading: true })"),
    ).toBeLessThan(
      openDetail.indexOf("await getSystemRoleSkillClient(skill.id)"),
    );
    expect(dialog).toContain("loading={detailState.loading}");
    expect(detail).toContain('aria-label="正在加载 Skill 详情"');
    expect(detail).toContain("<SkeletonText");
  });

  it("reuses a loaded Skill detail while its revision is unchanged", () => {
    const dialog = source("components/role-skills/role-skill-dialog.tsx");
    const openDetailStart = dialog.indexOf("const openDetail");
    const openDetailEnd = dialog.indexOf("const openPersonal", openDetailStart);
    const openDetail = dialog.slice(openDetailStart, openDetailEnd);

    expect(openDetail).toContain("getCachedRoleSkillData");
    expect(openDetail).toContain("cached.revision === skill.revision");
    expect(openDetail).toContain(
      "setDetailState({ skill: cached, loading: false })",
    );
    expect(openDetail).toContain(
      "setDetailState({ skill: loaded, loading: false })",
    );
  });

  it("uses one compact Skill trigger with the custom module icon", () => {
    const triggerPath = path.join(
      process.cwd(),
      "components/role-skills/role-skill-trigger.tsx",
    );
    const batch = source(
      "components/batch-workbench/batch-role-positioning.tsx",
    );
    const batchSettings = source(
      "components/batch-workbench/batch-settings-panel.tsx",
    );
    const imageTool = source("app/image/image-tool.tsx");

    expect(fs.existsSync(triggerPath)).toBe(true);
    if (!fs.existsSync(triggerPath)) return;

    const trigger = source("components/role-skills/role-skill-trigger.tsx");
    expect(trigger).toContain("SkillModuleIcon");
    expect(trigger).not.toContain("SquareArrowOutUpRight");
    expect(trigger).toContain("h-6");
    expect(trigger).toContain("text-xs");
    expect(trigger).toContain("font-medium");
    expect(trigger).toContain("border-0");
    expect(trigger).toContain("bg-transparent");
    expect(trigger).not.toContain("bg-[var(--panel-2)]");
    expect(trigger).toContain("text-[var(--primary-bg)]");
    expect(batch).toContain("<RoleSkillTrigger");
    expect(imageTool).toContain("<RoleSkillTrigger");
    expect(batchSettings).toContain("items-center justify-between gap-2");
    expect(imageTool).toContain("items-center justify-between gap-2");
  });

  it("uses the shared category control and app theme tokens", () => {
    const editor = source("components/role-skills/role-skill-editor.tsx");
    const dialog = source("components/role-skills/role-skill-dialog.tsx");
    expect(editor).toMatch(/<FrostedSelect\s+value=\{value\.category\}/);
    expect(`${editor}\n${dialog}`).not.toMatch(/<select(?:\s|>)/);
    expect(dialog).toContain("var(--panel-bg)");
    expect(dialog).not.toMatch(/dark:bg-\[#/);
  });

  it("overlays the side panel without resizing the catalog and keeps the result scrollable", () => {
    const dialog = source("components/role-skills/role-skill-dialog.tsx");

    expect(dialog).toContain(
      '<aside aria-label="技能测试面板" className="absolute inset-y-0 right-0 z-20',
    );
    expect(dialog).toContain("lg:grid-rows-[auto_minmax(0,1fr)]");
    expect(dialog).toContain("lg:col-start-1 lg:row-start-1");
    expect(dialog).toContain("grid-cols-[minmax(0,1fr)_48px]");
    expect(dialog).toContain("flex min-h-0 flex-1 flex-col overflow-y-auto");
  });

  it("shows only the selected Skill title in the right summary", () => {
    const dialog = source("components/role-skills/role-skill-dialog.tsx");
    const summaryStart = dialog.indexOf("{selectedSkill ? (");
    const summaryEnd = dialog.indexOf(") : (", summaryStart);
    const selectedSummary = dialog.slice(summaryStart, summaryEnd);

    expect(selectedSummary).toContain("{selectedSkill.name}");
    expect(selectedSummary).not.toContain("selectedSkill.summary");
    expect(selectedSummary).not.toContain("selectedSkill.usageScenario");
    expect(selectedSummary).not.toContain("selectedSkill.usageGuide");
  });

  it("requires an explicit editor save before converting a legacy prompt", () => {
    const dialog = source("components/role-skills/role-skill-dialog.tsx");
    expect(dialog).toContain("检测到旧版角色定位内容");
    expect(dialog).toContain("只有进入编辑器并点击“保存技能”后才会写入数据库");
    expect(dialog).toContain("createPersonalRoleSkillClient");
  });

  it("does not apply a full-screen backdrop filter behind the long detail view", () => {
    const dialog = source("components/role-skills/role-skill-dialog.tsx");

    expect(dialog).not.toContain("backdrop-blur");
  });

  it("virtualizes long formatted Skill content instead of mounting every block", () => {
    const detail = source("components/role-skills/role-skill-detail-view.tsx");
    const sharedView = source(
      "components/role-skills/role-skill-content-view.tsx",
    );

    expect(sharedView).toContain(
      "export function splitRoleSkillPreviewMarkdown",
    );
    expect(detail).toContain('from "react-virtuoso"');
    expect(detail).toContain("<Virtuoso");
    expect(detail).toContain("data={detailItems}");
    expect(detail).not.toContain(
      'className="role-skill-detail-scrollbar h-full overflow-y-auto"',
    );
  });
});
