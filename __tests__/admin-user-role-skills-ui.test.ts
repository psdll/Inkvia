import { readChineseUiSource as readFileSync } from "./helpers/chinese-ui-source";
import { resolve } from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import UserRoleSkillsPanel from "@/components/admin/UserRoleSkillsPanel";

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

const at = "2026-08-05T08:00:00.000Z";
const skills = [
  {
    id: "system:1",
    source: "system" as const,
    name: "商品摄影",
    summary: "稳定生成商品素材",
    category: "商业广告",
    coverUrl: null,
    mediaType: "image" as const,
    content: "系统完整正文",
    usageScenario: "商品图",
    usageGuide: "上传商品图",
    revision: 1,
    createdAt: at,
    updatedAt: at,
  },
  {
    id: "personal:2",
    source: "personal" as const,
    name: "我的分镜",
    summary: "账号自定义技能",
    category: "短剧",
    coverUrl: null,
    mediaType: "image" as const,
    content: "个人完整正文",
    usageScenario: "短剧素材",
    usageGuide: "输入剧情",
    revision: 1,
    createdAt: at,
    updatedAt: at,
  },
];

describe("administrator user Skill audit UI", () => {
  it("places the Skill tab beside prompt presets and requests its lazy section", () => {
    const tabs = source("components/admin/UserDetailTabBar.tsx");
    const page = source("app/admin/page.tsx");

    expect(tabs.indexOf('label="技能"')).toBeGreaterThan(
      tabs.indexOf('label="预设提示词"'),
    );
    expect(tabs).toContain('active === "skills"');
    expect(page).toContain('url.searchParams.set("section", "skills")');
    expect(page).toContain('tab === "skills"');
    expect(page).toContain("<UserRoleSkillsPanel skills={userRoleSkills} username={payload?.account?.username || activeUserItem?.username} />");
  });

  it("opens system and personal skills in the shared read-only detail view", () => {
    const html = renderToStaticMarkup(
      React.createElement(UserRoleSkillsPanel, { skills, username: "示例用户" }),
    );
    const panel = source("components/admin/UserRoleSkillsPanel.tsx");

    expect(html).toContain("商品摄影");
    expect(html).toContain("我的分镜");
    expect(html).toContain("官方");
    expect(html).toContain("示例用户");
    expect(html).toContain("详情");
    expect(html).not.toContain("系统完整正文");
    expect(html).not.toContain("个人完整正文");
    expect(panel).toContain("<RoleSkillCard");
    expect(panel).toContain("<RoleSkillDetailDialog");
    expect(panel).not.toContain("完整 Skill 内容");
    expect(panel).not.toContain("展开正文");
    expect(html).not.toContain("编辑");
    expect(html).not.toContain("删除");
  });

  it("supports themed full-text search without mutation APIs", () => {
    const panel = source("components/admin/UserRoleSkillsPanel.tsx");

    expect(panel).toContain(
      "skill.name, skill.category, skill.summary, skill.content",
    );
    expect(panel).toContain('aria-label="搜索技能"');
    expect(panel).toContain("onChange={(event) => setQuery(event.target.value)}");
    expect(panel).not.toMatch(/<select\b/);
    expect(panel).not.toContain("updatePersonalRoleSkill");
    expect(panel).not.toContain("deletePersonalRoleSkill");
  });
});
