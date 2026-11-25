import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isPublicExport } from "./support/public-export";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

describe("tool workspace draft schema", () => {
  it("defines owned versioned drafts and ordered media relations", () => {
    const schema = read("prisma/schema.prisma");

    expect(schema).toContain("toolWorkspaceDrafts ToolWorkspaceDraft[]");
    expect(schema).toContain("workspaceDraftMedia ToolWorkspaceDraftMedia[]");
    expect(schema).toContain("model ToolWorkspaceDraft {");
    expect(schema).toContain("@@unique([authUserId, tool])");
    expect(schema).toContain("model ToolWorkspaceDraftMedia {");
    expect(schema).toContain("@@unique([draftId, position])");
  });

  it("uses an additive migration and registers both protected tables", () => {
    const migration = read(
      "prisma/migrations/20260810120000_tool_workspace_drafts/migration.sql",
    );

    expect(migration).toContain('CREATE TABLE "ToolWorkspaceDraft"');
    expect(migration).toContain('CREATE TABLE "ToolWorkspaceDraftMedia"');
    expect(migration).not.toMatch(/DROP TABLE|TRUNCATE|DELETE FROM/i);

    if (!isPublicExport) {
      const protection = JSON.parse(read("config/deploy/data-protection.json"));
      expect(protection.database.expectedNewTables).toEqual(
        expect.arrayContaining(["ToolWorkspaceDraft", "ToolWorkspaceDraftMedia"]),
      );
    }
  });
});
