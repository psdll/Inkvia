import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const schema = fs.readFileSync(path.join(root, "prisma", "schema.prisma"), "utf8");
const migrationPath = path.join(root, "prisma", "migrations", "20260720210000_canvas_media_lifecycle", "migration.sql");

describe("canvas media production schema", () => {
  it("models immutable media identity and polymorphic references", () => {
    expect(schema).toMatch(/model MediaAsset \{/);
    expect(schema).toMatch(/id\s+String\s+@id @default\(uuid\(\)\) @db\.Uuid/);
    expect(schema).toMatch(/status\s+String\s+@default\("initiated"\)/);
    expect(schema).toMatch(/referenceCount\s+Int\s+@default\(0\)/);
    expect(schema).toMatch(/model MediaReference \{/);
    expect(schema).toMatch(/@@unique\(\[mediaId, sourceType, sourceId\]\)/);
  });

  it("creates lifecycle indexes and database-enforced state checks additively", () => {
    const sql = fs.readFileSync(migrationPath, "utf8");
    expect(sql).toContain('CREATE TABLE "MediaAsset"');
    expect(sql).toContain('CREATE TABLE "MediaReference"');
    expect(sql).toContain('CHECK ("status" IN');
    expect(sql).toContain('"MediaAsset_status_retentionUntil_idx"');
    expect(sql).toContain('"MediaReference_sourceType_sourceId_idx"');
    expect(sql).not.toMatch(/DROP\s+(?:TABLE|COLUMN)/i);
  });
});
