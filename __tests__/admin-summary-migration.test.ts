import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = path.join(
  process.cwd(),
  "prisma",
  "migrations",
  "20260716140000_incremental_admin_user_summaries",
  "migration.sql",
);
const tombstoneMigrationPath = path.join(
  process.cwd(),
  "prisma",
  "migrations",
  "20260716150000_admin_user_summary_tombstones",
  "migration.sql",
);

describe("incremental admin user summary migration", () => {
  it("only adds summary fields, indexes and a richer delete event snapshot", () => {
    const sql = fs.readFileSync(migrationPath, "utf8");

    expect(sql).toContain('ALTER TABLE "AdminUserSummary" ADD COLUMN');
    expect(sql).toContain('"successTaskCount" INTEGER NOT NULL DEFAULT 0');
    expect(sql).toContain('"failedTaskCount" INTEGER NOT NULL DEFAULT 0');
    expect(sql).toContain('"linkedUserIds" JSONB NOT NULL DEFAULT \'[]\'');
    expect(sql).toContain('CREATE INDEX "AdminUserSummary_updatedAt_adminKey_idx"');
    expect(sql).toContain("'createdAt', OLD.\"createdAt\"");
    expect(sql).toContain("'sizeBytes', OLD.\"sizeBytes\"");
    expect(sql).not.toMatch(/\bDROP TABLE\b|\bDROP COLUMN\b|\bTRUNCATE\b/i);
  });

  it("adds a non-destructive summary tombstone and active-list index", () => {
    const sql = fs.readFileSync(tombstoneMigrationPath, "utf8");
    expect(sql).toContain('ADD COLUMN "deletedAt" TIMESTAMP(3)');
    expect(sql).toContain('CREATE INDEX "AdminUserSummary_deletedAt_lastActiveAt_idx"');
    expect(sql).not.toMatch(/\bDROP TABLE\b|\bDROP COLUMN\b|\bTRUNCATE\b/i);
  });
});
