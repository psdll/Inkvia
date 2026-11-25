import { createHash } from "node:crypto";
import { readChineseUiSource as readFileSync } from "./helpers/chinese-ui-source";
import { describe, expect, it } from "vitest";
import { isPublicExport } from "./support/public-export";

const read = (relativePath: string) =>
  readFileSync(relativePath, "utf8").replace(/\r\n/g, "\n");

describe("unified role skills release gate", () => {
  it("keeps both user entry points on the shared dialog and isolates batch modes", () => {
    const imageTool = read("app/image/image-tool.tsx");
    const batchSkill = read("components/batch-workbench/batch-role-positioning.tsx");
    const batchSettings = read("components/batch-workbench/batch-settings-panel.tsx");

    expect(imageTool).toContain('dynamic(() => import("@/components/role-skills/role-skill-dialog")');
    expect(imageTool).toContain("<RoleSkillDialog");
    expect(batchSkill).toContain('import { RoleSkillDialog }');
    expect(batchSkill).toContain("<RoleSkillDialog");
    expect(batchSettings).toMatch(
      /batch\.mode === "multi_prompt" \? \([\s\S]*?<BatchRolePositioning/,
    );

    const styleBranch = batchSettings.slice(
      batchSettings.indexOf('{batch.mode === "style_replication" ? ('),
      batchSettings.indexOf('{batch.mode === "style_replication" ? (') + 1_200,
    );
    expect(styleBranch).not.toContain("BatchRolePositioning");
    expect(styleBranch).not.toContain("RoleSkillDialog");
  });

  it("does not expose system skill content through the ordinary catalog or task DTO", () => {
    const contracts = read("lib/role-skills/contracts.ts");
    const publicListItem = contracts.slice(
      contracts.indexOf("export type RoleSkillListItem"),
      contracts.indexOf("export type RoleSkillDetail"),
    );
    const catalogRoute = read("app/api/role-skills/route.ts");
    const repository = read("lib/role-skills/repository.ts");
    const publicMapper = repository.slice(
      repository.indexOf("function toListItem"),
      repository.indexOf("function toDetail"),
    );
    const promptReverseRoute = read("app/api/prompt-reverse/route.ts");
    const taskSerializer = promptReverseRoute.slice(
      promptReverseRoute.indexOf("function serializePromptReverseTask"),
        promptReverseRoute.indexOf("async function buildReverseMediaUrls"),
    );

    expect(publicListItem).not.toMatch(/\bcontent\s*:/);
    expect(catalogRoute).toContain("listRoleSkillsForUser");
    expect(catalogRoute).not.toContain("toDetail");
    expect(publicMapper).not.toMatch(/\bcontent\s*:/);
    expect(taskSerializer).not.toContain("systemPrompt");
    expect(taskSerializer).not.toMatch(/\bcontent\s*:/);
  });

  it("keeps Skill entries always visible and preserves account lifecycle coverage", () => {
    const navigation = read("components/admin/system-navigation.ts");
    const section = read("components/admin/RolePositioningSection.tsx");
    const imageTool = read("app/image/image-tool.tsx");
    const batchController = read("hooks/use-batch-role-positioning-controller.ts");
    const exporter = read("lib/admin/user-export-builder.ts");
    const importer = read("lib/admin/user-import-runner.ts");
    const purge = read("app/api/admin/user/purge-data/route.ts");
    const deletion = read("app/api/admin/user/delete/route.ts");

    expect(navigation).toContain('key: "rolePositioning"');
    expect(navigation).toContain('id: "sys-role-positioning"');
    expect(navigation).toContain('label: "技能"');
    expect(section).toContain('id="sys-role-positioning"');
    expect(section).toContain("<SystemRoleSkillsPanel />");
    expect(section).not.toContain("/api/admin/settings/role-positioning");
    expect(imageTool).not.toContain("/api/role-positioning/status");
    expect(batchController).not.toContain("/api/role-positioning/status");

    expect(exporter).toContain("UserRoleSkillArchiveV1");
    expect(exporter).toContain("buildUserRoleSkillArchiveV1");
    expect(importer).toContain("restoreUserRoleSkillArchiveV1");
    expect(importer).toContain("remapPromptReverseTaskRoleSkill");
    expect(purge).toContain("resetAdminUserRoleSkillData");
    expect(purge).toContain("roleSkillCoverRefs");
    expect(deletion).toContain("deletedUserRoleSkills");
    expect(deletion).toContain("roleSkillCoverRefs");
  });

  it("uses themed dialogs instead of browser-native Skill popups", () => {
    const personalDialog = read(
      "components/role-skills/role-skill-dialog.tsx",
    );
    const systemPanel = read("components/admin/SystemRoleSkillsPanel.tsx");
    const skillUi = `${personalDialog}\n${systemPanel}`;

    expect(skillUi).not.toMatch(
      /\b(?:window\.)?(?:confirm|alert|prompt)\s*\(/,
    );
    expect(personalDialog).toContain('import { ConfirmDialog }');
    expect(systemPanel).toContain('import { ConfirmDialog }');
    expect(personalDialog).toContain("<ConfirmDialog");
    expect(systemPanel).toContain("<ConfirmDialog");
  });

  it("ships the additive migration under the pinned policy", () => {
    const migrationPath =
      "prisma/migrations/20260805170000_add_unified_role_skills/migration.sql";
    const migration = read(migrationPath);
    const policy = JSON.parse(read("config/deploy/migration-policy.json")) as {
      migrations: Array<Record<string, unknown>>;
    };
    const entry = policy.migrations.find(
      (item) => item.name === "20260805170000_add_unified_role_skills",
    );
    expect(entry).toMatchObject({
      class: "expand",
      execution: "automatic",
      historicalRowWrites: false,
      oldCodeCompatible: true,
    });
    expect(entry?.sha256).toBe(
      createHash("sha256")
        .update(migration.replace(/\r\n?/g, "\n"))
        .digest("hex"),
    );
    if (isPublicExport) return;
    const assembler = read("scripts/assemble-prebuilt-release.mjs");
    expect(assembler).toContain('["prisma/migrations", "prisma/migrations"]');
    expect(assembler).toContain(
      '["prisma/migrations", ".next/standalone/prisma/migrations"]',
    );
    expect(assembler).toContain('"config/deploy/migration-policy.json"');
  });

  it.skipIf(isPublicExport)("documents the production rehearsal, leak check, and code-only rollback", () => {
    const runbook = read("docs/deployment/unified-role-skills-runbook.md");

    for (const checkpoint of [
      "pg_dump",
      "sha256sum",
      "migrate deploy",
      "migrate status",
      "空库演练",
      "生产副本演练",
      "旧版本兼容检查",
      "首个系统 Skill",
      "Network 泄漏检查",
      "只回滚应用代码",
      "不得回滚数据库 migration",
    ]) {
      expect(runbook).toContain(checkpoint);
    }
  });
});
