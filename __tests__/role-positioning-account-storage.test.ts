import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("account-scoped role positioning storage", () => {
  it("uses an additive account-and-surface schema with a legacy task default", () => {
    const schema = read("prisma/schema.prisma");
    const migration = read(
      "prisma/migrations/20260804130000_account_role_positioning_drafts/migration.sql",
    );
    const continuationMigration = read(
      "prisma/migrations/20260811110000_role_positioning_continuations/migration.sql",
    );

    expect(schema).toContain("model RolePositioningDraft {");
    expect(schema).toContain("continuation");
    expect(schema).toContain("@@unique([authUserId, surface])");
    expect(schema).toContain('surface           String    @default("toolbox_image")');
    expect(migration).toContain('CREATE TABLE "RolePositioningDraft"');
    expect(continuationMigration).toContain('ADD COLUMN "continuation" JSONB');
    expect(migration).toContain(
      'ADD COLUMN "surface" VARCHAR(32) NOT NULL DEFAULT \'toolbox_image\'',
    );
    expect(migration).not.toMatch(/DROP\s+(TABLE|COLUMN)/i);
  });

  it("hydrates and autosaves full drafts through the account API", () => {
    const hook = read("hooks/use-account-role-positioning-draft.ts");
    const client = read("lib/account-role-positioning-draft-client.ts");

    expect(hook).toContain('/api/role-positioning/draft?surface=');
    expect(client).toContain('method: "PUT"');
    expect(hook).toContain("putAccountRolePositioningDraft");
    expect(hook).toContain("saveError");
    expect(hook).toContain("systemPrompt");
    expect(hook).toContain("reversePrompt");
    expect(hook).toContain("activeReverseTaskId");
    expect(hook).toContain("continuation");
    expect(hook).toContain("window.setTimeout");
    expect(hook).toContain('window.addEventListener("pagehide"');
    expect(hook).toContain("saveNow: enqueueSave");
    expect(hook).toContain("{ ...draftRef.current, ...update }");
    expect(hook).toContain("return result;");
    expect(hook).toContain("Promise<DraftSaveResult>");
  });
});
