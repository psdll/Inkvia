import { existsSync } from "node:fs";
import { readChineseUiSource as readFileSync } from "./helpers/chinese-ui-source";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("administrator segmented prompt rule page", () => {
  it("gives batch rules an independent settings page instead of a Skill tab", () => {
    const section = source("components/admin/RolePositioningSection.tsx");

    expect(section).not.toContain('role="tablist"');
    expect(section).not.toContain("SegmentedPromptRulePanel");
    expect(section).toContain("<SystemRoleSkillsPanel />");
    const systemTab = source("components/admin/AdminSystemTab.tsx");
    expect(systemTab).toContain('case "segmentedPromptRule":');
    expect(systemTab).toContain("<SegmentedPromptRulePanel />");
    expect(systemTab).toContain("segmentedPromptRule: loadSegmentedPromptRulePanel");
  });

  it("shows the effective global rule in an isolated panel", () => {
    const panelPath = resolve(
      process.cwd(),
      "components/admin/SegmentedPromptRulePanel.tsx",
    );

    expect(existsSync(panelPath)).toBe(true);
    if (!existsSync(panelPath)) return;

    const panel = source("components/admin/SegmentedPromptRulePanel.tsx");
    expect(panel).toContain('id="sys-segmented-prompt-rule"');
    expect(panel).toContain("批量分段规则");
    expect(panel).toContain("适用于：批量页面 → 自定义分批");
    expect(panel).toContain("不适用于“统一参考批量复刻”");
    expect(panel).toContain("展开完整规则");
    expect(panel).toMatch(/<details[^>]*>/);
    expect(panel).not.toMatch(/<details[^>]*\bopen(?:[\s=>])/);
    expect(panel).toContain("当前生效规则");
    expect(panel).toContain("标题可选");
    expect(panel).toContain("每个非空行");
    expect(panel).toContain("空行分隔内容块");
    expect(panel).toContain("最多 50 段");
    expect(panel).not.toContain("RoleSkillCard");
    expect(panel).not.toContain("SystemRoleSkillsPanel");
  });

  it("offers an unrestricted rule editor and a parser test bench", () => {
    const panelPath = resolve(
      process.cwd(),
      "components/admin/SegmentedPromptRulePanel.tsx",
    );
    if (!existsSync(panelPath)) return;

    const panel = source("components/admin/SegmentedPromptRulePanel.tsx");
    expect(panel).toContain("编辑分段规则");
    expect(panel).toContain("自定义解析规则");
    expect(panel).toContain("不限定标题格式、分隔符、段落命名或 Markdown 结构");
    expect(panel).toContain('aria-label="自定义解析规则"');
    expect(panel).toContain("载入当前规则");
    expect(panel).toContain("清空");
    expect(panel).toContain("测试分段");
    expect(panel).toContain("保存并启用");
    expect(panel).toContain("恢复系统默认");
    expect(panel).toContain("/api/admin/settings/segmented-prompt-rule");
    expect(panel).toContain("expectedRevision");
    expect(panel).toContain("请先测试当前规则");
    expect(panel).not.toContain("页面原型");
    expect(panel).not.toContain("尚未写入配置");
    expect(panel).not.toContain("FrostedSelect");
    expect(panel).not.toContain("COMPATIBILITY_OPTIONS");
    expect(panel).not.toContain("最大分段数");
    expect(panel).not.toMatch(/<select\b/);
    expect(panel).toContain("bg-[var(--panel-2)]");
    expect(panel).toContain("border-[var(--border)]");
    expect(panel).toContain("bg-[var(--input-bg)]");
  });
});
