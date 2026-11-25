import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isPublicExport } from "./support/public-export";

const schema = readFileSync("prisma/schema.prisma", "utf8");
const migration = readFileSync(
  "prisma/migrations/20260728150000_image_batch_workbench/migration.sql",
  "utf8",
);
const groupMigrationPath =
  "prisma/migrations/20260729100000_image_batch_task_groups/migration.sql";

describe("image batch persistent schema", () => {
  it("defines the four owned batch models and durable relationships", () => {
    for (const model of ["ImageBatch", "ImageBatchItem", "ImageBatchMedia", "ImageBatchOutput"]) {
      expect(schema).toContain(`model ${model} {`);
      expect(migration).toContain(`CREATE TABLE \"${model}\"`);
    }
    expect(schema).toMatch(/imageBatches\s+ImageBatch\[\]/);
    expect(schema).toMatch(/batchMedia\s+ImageBatchMedia\[\]/);
    expect(schema).toMatch(/batchOutput\s+ImageBatchOutput\?/);
    expect(schema).toMatch(/lastSubmissionKey\s+String\?/);
    expect(migration).not.toContain('"lastSubmissionKey" VARCHAR(128)');
  });

  it("keeps queue idempotency and ownership indexes in the migration", () => {
    expect(migration).toContain('CREATE UNIQUE INDEX "ImageBatchOutput_requestKey_key"');
    expect(migration).toContain('CREATE UNIQUE INDEX "ImageBatchOutput_generationId_key"');
    expect(migration).toContain('CREATE INDEX "ImageBatchOutput_status_nextPollAt_createdAt_idx"');
    expect(migration).toContain('CREATE INDEX "ImageBatch_authUserId_status_updatedAt_idx"');
    expect(migration).toContain('ON DELETE SET NULL ON UPDATE CASCADE');
  });

  it("repairs the submission key through an additive compatibility migration", () => {
    const repairPath = "prisma/migrations/20260728204500_image_batch_submission_key/migration.sql";
    expect(existsSync(repairPath)).toBe(true);
    const repair = readFileSync(repairPath, "utf8");
    expect(repair).toContain('ADD COLUMN IF NOT EXISTS "lastSubmissionKey" VARCHAR(128)');
  });

  it("stores editable task groups without rewriting historical batch rows", () => {
    expect(existsSync(groupMigrationPath)).toBe(true);
    const groupMigration = readFileSync(groupMigrationPath, "utf8");
    expect(schema).toContain("model ImageBatchGroup {");
    expect(schema).toMatch(/groups\s+ImageBatchGroup\[\]/);
    expect(schema).toMatch(/groupId\s+String\?/);
    expect(groupMigration).toContain('CREATE TABLE "ImageBatchGroup"');
    expect(groupMigration).toContain('ADD COLUMN "groupId" UUID');
    expect(groupMigration).not.toMatch(/^\s*(?:INSERT|UPDATE|DELETE|MERGE)\b/im);
  });

  it.skipIf(isPublicExport)("registers only the new tables in the additive deployment allowlist", () => {
    const protection = JSON.parse(readFileSync("config/deploy/data-protection.json", "utf8"));
    const expected = protection.database.expectedNewTables as string[];
    for (const table of [
      "ImageBatch",
      "ImageBatchGroup",
      "ImageBatchItem",
      "ImageBatchMedia",
      "ImageBatchOutput",
    ]) {
      expect(expected).toContain(table);
    }
  });
});
