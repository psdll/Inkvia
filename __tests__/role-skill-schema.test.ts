import crypto from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isPublicExport } from "./support/public-export";

const schema = readFileSync("prisma/schema.prisma", "utf8");
const migrationPath =
  "prisma/migrations/20260805170000_add_unified_role_skills/migration.sql";
const migration = existsSync(migrationPath)
  ? readFileSync(migrationPath, "utf8")
  : "";
const mediaTypeMigrationPath =
  "prisma/migrations/20260806143000_add_system_role_skill_media_type/migration.sql";
const mediaTypeMigration = existsSync(mediaTypeMigrationPath)
  ? readFileSync(mediaTypeMigrationPath, "utf8")
  : "";
const policy = JSON.parse(
  readFileSync("config/deploy/migration-policy.json", "utf8"),
);

function modelBlock(name: string) {
  return schema.match(new RegExp(`model ${name} \\{[\\s\\S]*?^\\}`, "m"))?.[0] ?? "";
}

describe("unified role skill persistent schema", () => {
  it("defines system and account-owned role skills", () => {
    expect(schema).toMatch(/roleSkills\s+UserRoleSkill\[\]/);

    const systemSkill = modelBlock("SystemRoleSkill");
    const userSkill = modelBlock("UserRoleSkill");
    for (const block of [systemSkill, userSkill]) {
      expect(block).toMatch(/^\s*id\s+BigInt\s+@id\s+@default\(autoincrement\(\)\)/m);
      expect(block).toMatch(/^\s*name\s+String\s+@db\.VarChar\(64\)/m);
      expect(block).toMatch(/^\s*summary\s+String\s+@db\.VarChar\(200\)/m);
      expect(block).toMatch(/^\s*category\s+String\s+@db\.VarChar\(64\)/m);
      expect(block).toMatch(/^\s*coverUrl\s+String\?\s+@db\.Text/m);
      expect(block).toMatch(/^\s*content\s+String\s+@db\.Text/m);
      expect(block).toMatch(/^\s*usageScenario\s+String\s+@db\.Text/m);
      expect(block).toMatch(/^\s*usageGuide\s+String\s+@db\.Text/m);
      expect(block).toMatch(/^\s*revision\s+Int\s+@default\(1\)/m);
      expect(block).toMatch(/^\s*deletedAt\s+DateTime\?/m);
    }

    expect(systemSkill).toMatch(
      /^\s*status\s+String\s+@default\("hidden"\)\s+@db\.VarChar\(16\)/m,
    );
    expect(systemSkill).toMatch(/^\s*mediaType\s+String\?\s+@db\.VarChar\(16\)/m);
    expect(systemSkill).toContain("@@index([status, deletedAt, updatedAt])");
    expect(systemSkill).toContain("@@index([category, status, deletedAt])");
    expect(userSkill).toMatch(
      /^\s*authUser\s+User\s+@relation\(fields: \[authUserId\], references: \[id\], onDelete: Cascade\)/m,
    );
    expect(userSkill).toContain("@@index([authUserId, deletedAt, updatedAt])");
    expect(userSkill).toContain("@@index([authUserId, category, deletedAt])");
  });

  it("adds the backward-compatible system Skill media type column with an expand-only migration", () => {
    expect(existsSync(mediaTypeMigrationPath)).toBe(true);
    expect(mediaTypeMigration).toContain('ADD COLUMN "mediaType" VARCHAR(16)');
    expect(mediaTypeMigration).not.toMatch(/NOT NULL|DEFAULT|\b(?:DROP|RENAME|TRUNCATE)\b/i);

    const entry = policy.migrations.find(
      (item: { name: string }) =>
        item.name === "20260806143000_add_system_role_skill_media_type",
    );
    expect(entry).toMatchObject({
      class: "expand",
      execution: "automatic",
      historicalRowWrites: false,
      oldCodeCompatible: true,
    });
    const hash = crypto
      .createHash("sha256")
      .update(mediaTypeMigration.replace(/\r\n?/g, "\n"))
      .digest("hex");
    expect(entry?.sha256).toBe(hash);
  });

  it("adds only nullable skill references to existing draft and task tables", () => {
    const draft = modelBlock("RolePositioningDraft");
    const task = modelBlock("PromptReverseTask");
    for (const field of [
      "selectedSkillSource",
      "selectedSkillId",
      "resultSkillSource",
      "resultSkillId",
      "resultSkillName",
      "resultSkillRevision",
    ]) {
      expect(draft).toMatch(new RegExp(`^\\s*${field}\\s+\\w+\\?`, "m"));
    }
    for (const field of ["skillSource", "skillId", "skillName", "skillRevision"]) {
      expect(task).toMatch(new RegExp(`^\\s*${field}\\s+\\w+\\?`, "m"));
    }
  });

  it("uses an approved expand-only migration", () => {
    expect(existsSync(migrationPath)).toBe(true);
    expect(migration).toContain('CREATE TABLE "SystemRoleSkill"');
    expect(migration).toContain('CREATE TABLE "UserRoleSkill"');
    expect(migration).toMatch(
      /FOREIGN KEY \("authUserId"\) REFERENCES "User"\("id"\)\s+ON DELETE CASCADE ON UPDATE CASCADE/,
    );
    expect(migration).not.toMatch(/\b(?:DROP|RENAME|TRUNCATE)\b/i);
    expect(migration).not.toMatch(/^\s*(?:INSERT|UPDATE|DELETE|MERGE)\b/im);

    const entry = policy.migrations.find(
      (item: { name: string }) =>
        item.name === "20260805170000_add_unified_role_skills",
    );
    expect(entry).toMatchObject({
      class: "expand",
      execution: "automatic",
      historicalRowWrites: false,
      oldCodeCompatible: true,
    });
    const hash = crypto
      .createHash("sha256")
      .update(migration.replace(/\r\n?/g, "\n"))
      .digest("hex");
    expect(entry?.sha256).toBe(hash);
    if (!isPublicExport) {
      const protection = JSON.parse(readFileSync("config/deploy/data-protection.json", "utf8"));
      expect(protection.database.expectedNewTables).toEqual(
        expect.arrayContaining(["SystemRoleSkill", "UserRoleSkill"]),
      );
    }
  });
});
