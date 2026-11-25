import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("Canvas V2 persistence schema", () => {
  it("adds only the canvas project, revision and run persistence fields", () => {
    const schema = readFileSync(join(root, "prisma/schema.prisma"), "utf8");

    expect(schema).toContain("model CanvasProject {");
    expect(schema).toContain("model CanvasRun {");
    expect(schema).toMatch(/revision\s+Int\s+@default\(1\)/);
    expect(schema).toMatch(/projectId\s+Int\?/);
    expect(schema).toMatch(/canvasProjects\s+CanvasProject\[\]/);
    expect(schema).toMatch(/canvasRuns\s+CanvasRun\[\]/);
  });

  it("uses additive DDL and removes the destructive legacy cleanup migration", () => {
    const destructive = readFileSync(
      join(root, "prisma/migrations/20260713090000_remove_legacy_canvas_data/migration.sql"),
      "utf8",
    );
    const migration = readFileSync(
      join(root, "prisma/migrations/20260713130000_canvas_v2_foundation/migration.sql"),
      "utf8",
    );

    expect(destructive).not.toMatch(/DELETE\s+FROM\s+"Canvas"/i);
    expect(migration).toContain('CREATE TABLE "CanvasProject"');
    expect(migration).toContain('CREATE TABLE "CanvasRun"');
    expect(migration).toContain('ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1');
    expect(migration).not.toMatch(/DELETE\s+FROM|DROP\s+(?:TABLE|COLUMN)/i);
  });
});
