import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = join(
  process.cwd(),
  "prisma",
  "migrations",
  "20260819180000_allow_batch_workspace_media_references",
  "migration.sql",
);

describe("batch product library production migration", () => {
  it("allows batch_workspace media references without removing existing reference types", () => {
    expect(
      existsSync(migrationPath),
      "missing migration for the batch_workspace MediaReference source type",
    ).toBe(true);

    const sql = readFileSync(migrationPath, "utf8");
    expect(sql.trimStart()).toMatch(/^BEGIN;/);
    expect(sql.trimEnd()).toMatch(/COMMIT;$/);
    expect(sql).toContain('DROP CONSTRAINT "MediaReference_sourceType_check"');
    expect(sql).toContain('ADD CONSTRAINT "MediaReference_sourceType_check"');
    for (const sourceType of [
      "canvas_current",
      "canvas_snapshot",
      "generation",
      "library",
      "batch_workspace",
    ]) {
      expect(sql).toContain(`'${sourceType}'`);
    }
  });
});
