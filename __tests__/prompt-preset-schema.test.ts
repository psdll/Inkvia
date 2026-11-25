import crypto from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isPublicExport } from "./support/public-export";

const schema = readFileSync("prisma/schema.prisma", "utf8");
const migrationPath =
  "prisma/migrations/20260730113000_unified_prompt_presets/migration.sql";
const migration = existsSync(migrationPath) ? readFileSync(migrationPath, "utf8") : "";
const policy = JSON.parse(readFileSync("config/deploy/migration-policy.json", "utf8"));

function modelBlock(name: string) {
  return schema.match(new RegExp(`model ${name} \\{[\\s\\S]*?^\\}`, "m"))?.[0] ?? "";
}

function topLevelSqlStatements(sql: string) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--.*$/gm, " ")
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

describe("unified prompt preset persistent schema", () => {
  it("defines the four prompt preset models with the required durable contracts", () => {
    for (const model of [
      "PromptPreset",
      "BuiltinPromptPreset",
      "UserBuiltinPromptDeletion",
      "PromptPresetMigrationState",
    ]) {
      expect(schema).toContain(`model ${model} {`);
    }

    expect(schema).toMatch(/promptPresets\s+PromptPreset\[\]/);
    expect(schema).toMatch(/builtinPromptDeletions\s+UserBuiltinPromptDeletion\[\]/);
    expect(schema).toMatch(/promptPresetMigrationStates\s+PromptPresetMigrationState\[\]/);
    const promptPreset = modelBlock("PromptPreset");
    const builtinPromptPreset = modelBlock("BuiltinPromptPreset");
    const userBuiltinPromptDeletion = modelBlock("UserBuiltinPromptDeletion");
    const migrationState = modelBlock("PromptPresetMigrationState");
    const requiredCategory = /^\s*category\s+String\s+@db\.VarChar\(64\)\s*$/m;

    expect(promptPreset).toMatch(requiredCategory);
    expect(builtinPromptPreset).toMatch(requiredCategory);
    expect(promptPreset).toContain("@@unique([authUserId, legacyKey])");
    expect(promptPreset).not.toMatch(/^\s*(?:scope|surface|originBuiltinId)\s/m);
    expect(builtinPromptPreset).not.toMatch(/^\s*scope\s/m);
    expect(migrationState).toMatch(/^\s*subjectKey\s+String\s+@unique\s+@db\.VarChar\(128\)\s*$/m);
    expect(userBuiltinPromptDeletion).toMatch(/^\s*authUser\s+User\s+@relation\(fields: \[authUserId\], references: \[id\], onDelete: Cascade\)\s*$/m);
    expect(userBuiltinPromptDeletion).toMatch(/^\s*builtinPromptPreset\s+BuiltinPromptPreset\s+@relation\(fields: \[builtinPromptPresetId\], references: \[id\], onDelete: Cascade\)\s*$/m);
    expect(userBuiltinPromptDeletion).toContain("@@id([authUserId, builtinPromptPresetId])");
    const nullableCategory = "model PromptPreset {\n  category String? @db.VarChar(64)\n}";
    expect(nullableCategory).not.toMatch(/^\s*category\s+String\s+@db\.VarChar\(64\)\s*$/m);
  });

  it("creates exactly the additive prompt preset tables, indexes, and foreign keys", () => {
    expect(existsSync(migrationPath)).toBe(true);
    for (const table of [
      "PromptPreset",
      "BuiltinPromptPreset",
      "UserBuiltinPromptDeletion",
      "PromptPresetMigrationState",
    ]) {
      expect(migration).toContain(`CREATE TABLE \"${table}\"`);
    }
    const statements = topLevelSqlStatements(migration);
    const createTables = statements.filter((statement) => /^CREATE TABLE\b/.test(statement));
    const createIndexes = statements.filter((statement) => /^CREATE (?:UNIQUE )?INDEX\b/.test(statement));
    const addForeignKeys = statements.filter((statement) =>
      /^ALTER TABLE "[^"]+" ADD CONSTRAINT "[^"]+" FOREIGN KEY\b/.test(statement),
    );
    expect(createTables).toHaveLength(4);
    expect(createIndexes).toHaveLength(7);
    expect(addForeignKeys).toHaveLength(4);
    expect(statements).toHaveLength(15);
    expect(statements).toEqual(expect.arrayContaining([
      ...createTables,
      ...createIndexes,
      ...addForeignKeys,
    ]));
    expect(migration).not.toMatch(/\b(?:DROP|TRUNCATE)\b/i);
    expect(migration).not.toMatch(/^\s*(?:INSERT|UPDATE|DELETE|MERGE)\b/im);
  });

  it("protects all new tables and authorizes the additive migration", () => {
    if (!isPublicExport) {
      const protection = JSON.parse(readFileSync("config/deploy/data-protection.json", "utf8"));
      expect(protection.database.expectedNewTables).toEqual(expect.arrayContaining([
        "PromptPreset", "BuiltinPromptPreset", "UserBuiltinPromptDeletion", "PromptPresetMigrationState",
      ]));
    }

    expect(policy.allowDestructiveMigration).toBe(false);
    expect(policy.migrations).toContainEqual(expect.objectContaining({
      name: "20260730113000_unified_prompt_presets",
      class: "expand",
      execution: "automatic",
      historicalRowWrites: false,
      oldCodeCompatible: true,
    }));
    const migrationPolicy = policy.migrations.find(
      (entry: { name: string }) => entry.name === "20260730113000_unified_prompt_presets",
    );
    const migrationHash = crypto.createHash("sha256")
      .update(migration.replace(/\r\n?/g, "\n"))
      .digest("hex");
    expect(migrationHash).toBe("f1ddda039058367c41428caf0b18c9902451d648a1295c85f133dd3957396fe8");
    expect(migrationPolicy.sha256).toBe("f1ddda039058367c41428caf0b18c9902451d648a1295c85f133dd3957396fe8");
  });
});
