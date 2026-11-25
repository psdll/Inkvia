import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { validateMigrationPolicy } from "../scripts/validate-migration-policy.mjs";

describe("imported data retention", () => {
  it("uses restoredAt before createdAt when selecting expired rows", async () => {
    const retention = await import("@/lib/data-retention").catch(() => null) as any;
    expect(typeof retention?.retentionCutoffWhere).toBe("function");
    if (typeof retention?.retentionCutoffWhere !== "function") return;

    const cutoff = new Date("2026-07-01T00:00:00.000Z");
    expect(retention.retentionCutoffWhere(cutoff)).toEqual({
      OR: [
        { restoredAt: { lt: cutoff } },
        { restoredAt: null, createdAt: { lt: cutoff } },
      ],
    });
  });

    it("keeps linked logs on the generation lifecycle and preserves billing ledgers in manual cleanup", () => {
    const automatic = readFileSync(resolve(process.cwd(), "lib/log-retention.ts"), "utf8");
    const manual = readFileSync(resolve(process.cwd(), "app/api/admin/storage/route.ts"), "utf8");

    expect(automatic).toContain("retentionCutoffWhere");
    expect(automatic).toContain("generationId: null");
    expect(manual).toContain("retentionCutoffWhere");
      expect(manual).not.toContain("usageLedger.deleteMany");
  });

  it("stores a separate restore timestamp without changing historical createdAt", () => {
    const schema = readFileSync(resolve(process.cwd(), "prisma/schema.prisma"), "utf8");
    expect(schema.match(/restoredAt\s+DateTime\?/g)?.length).toBe(2);
  });

  it("runs retention from the background scheduler instead of relying on page traffic", () => {
    const bootstrap = readFileSync(resolve(process.cwd(), "lib/server-bootstrap.ts"), "utf8");
    expect(bootstrap).toContain("RETENTION_INTERVAL_MS");
    expect(bootstrap).toContain("runDataRetention");
  });

  it("removes linked batch cards in the same transaction before physical generation deletion", () => {
    const automatic = readFileSync(resolve(process.cwd(), "lib/log-retention.ts"), "utf8");
    const adminStorage = readFileSync(resolve(process.cwd(), "app/api/admin/storage/route.ts"), "utf8");
    const history = readFileSync(resolve(process.cwd(), "app/api/history/cleanup/route.ts"), "utf8");

    for (const source of [automatic, adminStorage, history]) {
      expect(source).toContain("deleteGenerationRowsAndBatchCards");
    }
    expect(automatic).not.toContain("prisma.generation.deleteMany");
    expect(adminStorage).not.toContain("prisma.generation.deleteMany");
    expect(history).not.toContain("prisma.generation.delete({");
    expect(history.indexOf("computeDeletableRefsForGenerationIds")).toBeLessThan(
      history.indexOf("prisma.$transaction"),
    );
    expect(history.indexOf("prisma.$transaction")).toBeLessThan(
      history.indexOf("deleteStoredMediaRefs(deletableRefs"),
    );
  });

  it("ships the canonical Generation output lookup as an approved online index", () => {
    const schema = readFileSync(resolve(process.cwd(), "prisma/schema.prisma"), "utf8");
    const indexSql = readFileSync(
      resolve(process.cwd(), "config/deploy/online-indexes/generation-local-path.sql"),
      "utf8",
    );
    const policy = readFileSync(resolve(process.cwd(), "config/deploy/migration-policy.json"), "utf8");

    expect(schema).toContain("@@index([localPath])");
    expect(indexSql).toContain('CREATE INDEX CONCURRENTLY IF NOT EXISTS "Generation_localPath_idx"');
    expect(policy).toContain('"file": "generation-local-path.sql"');
    const validation = validateMigrationPolicy({
      policy: JSON.parse(policy),
      pendingMigrations: [],
      candidateMigrations: [],
      onlineIndexes: [{ file: "generation-local-path.sql", sql: indexSql }],
    });
    expect(validation.errors).not.toContain(
      "online index definition does not match approval: generation-local-path.sql",
    );
    expect(validation.onlineIndexes).toContain("generation-local-path.sql");
  });
});
