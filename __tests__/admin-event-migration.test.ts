import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = path.join(
  process.cwd(),
  "prisma",
  "migrations",
  "20260716090000_reliable_admin_work_feed",
  "migration.sql",
);

describe("reliable admin work feed migration", () => {
  it("only adds compatible fields, indexes, functions and triggers", () => {
    const sql = fs.readFileSync(migrationPath, "utf8");

    expect(sql).toContain('ALTER TABLE "AdminEvent" ADD COLUMN');
    expect(sql).toContain('ALTER TABLE "AdminWorkFeed" ADD COLUMN');
    expect(sql).not.toContain('UPDATE "AdminEvent" SET "status"');
    expect(sql).toContain('CREATE OR REPLACE FUNCTION "enqueue_generation_admin_event"');
    expect(sql).toContain('AFTER INSERT OR UPDATE OR DELETE ON "Generation"');
    expect(sql).not.toMatch(/\bDROP TABLE\b|\bDROP COLUMN\b|\bTRUNCATE\b/i);
  });

  it("stores delete scope and generation id in a minimal tombstone event", () => {
    const sql = fs.readFileSync(migrationPath, "utf8");

    expect(sql).toContain("OLD.id");
    expect(sql).toContain("OLD.\"userId\"");
    expect(sql).toContain("OLD.\"authUserId\"");
    expect(sql).toContain("jsonb_build_object('generationId', OLD.id)");
  });
});
