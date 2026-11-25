import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isPublicExport } from "./support/public-export";

const updaterPath = path.join(process.cwd(), "config", "deploy", "server", "inkvia-updater");
const releaseWorkflowPath = path.join(process.cwd(), ".github", "workflows", "prebuilt-release.yml");
const policyPath = path.join(process.cwd(), "config", "deploy", "migration-policy.json");
const onlineIndexesPath = path.join(process.cwd(), "config", "deploy", "online-indexes");

describe("admin rollout release contract", () => {
  it.skipIf(isPublicExport)("tests before build, validates policy, verifies backup and gates success on readiness plus smoke requests", () => {
    const source = fs.readFileSync(updaterPath, "utf8");
    const workflow = fs.readFileSync(releaseWorkflowPath, "utf8");
    const releaseGates = [
      "run: npm ci",
      "run: npm run prisma:generate",
      "run: npm run typecheck",
      "run: npm run test:linux-deploy",
      "run: npm run build",
    ];
    const releaseGatePositions = releaseGates.map((gate) => workflow.indexOf(gate));
    expect(releaseGatePositions.every((position) => position > 0)).toBe(true);
    expect(releaseGatePositions).toEqual([...releaseGatePositions].sort((a, b) => a - b));
    expect(workflow).toContain("validate-migration-policy.mjs");
    expect(workflow).toContain("verify-production-migration-rehearsal.py");
    expect(source).not.toContain("npm test");
    expect(source).not.toContain("npm run build");
    expect(source).toContain('"/usr/bin/pg_dump"');
    expect(source).toContain('"/usr/bin/pg_restore"');
    expect(source).toContain("deploy_migrations(candidate");
    expect(source).toContain("deploy_online_indexes(candidate");
    expect(source).toContain("verify_online_indexes(candidate");
    expect(source.indexOf("deploy_migrations(candidate")).toBeLessThan(
      source.indexOf("deploy_online_indexes(candidate"),
    );
    expect(source).toContain("verify_migration_history(candidate");
    expect(source).toContain("/api/health/readiness");
    expect(source).toContain("/api/health/deployment");
    expect(source).not.toContain("admin-read-model-backfill.mjs --apply");
    expect(workflow).not.toContain("environment: production-release");
    expect(workflow).toContain("name: Publish stable application release");
    expect(workflow).toContain(
      "Recheck target uniqueness and publish stable Release",
    );
    expect(workflow).not.toContain("Create signed draft release candidate");
    expect(workflow).not.toContain('--draft=false');
    expect(source).toContain('["/usr/bin/pg_restore", "--list"');
    expect(source).toContain("/api/health/readiness?probe=");
    expect(source).toContain("/api/admin/login");
    expect(source).toContain("/api/admin/session");
    expect(source).toContain('"/admin"');
    expect(source).toContain("Current migrations are not a strict target prefix");
    expect(source).toContain("expectedNewTables");
    expect(source).toContain("postStartExistingTableRowPolicy");
    expect(source).toContain("compare_table_rows");
    expect(source).toContain("sha256_file(dump_path)");
  });

  it("keeps liveness process-only and exposes a separate readiness route", () => {
    const liveness = fs.readFileSync(path.join(process.cwd(), "app/api/health/liveness/route.ts"), "utf8");
    const readiness = fs.readFileSync(path.join(process.cwd(), "app/api/health/readiness/route.ts"), "utf8");
    expect(liveness).not.toMatch(/prisma|uploads|migration|AdminEvent/i);
    expect(readiness).toContain("runReadinessChecks");
  });

  it("serializes expensive full diff scans across application processes", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "lib", "server-bootstrap.ts"), "utf8");
    expect(source).toContain("admin-read-model-diff-check");
    expect(source).toContain("SET LOCAL statement_timeout");
    expect(source.indexOf("measureAdminReadModelDiff(tx)")).toBeLessThan(
      source.indexOf("measureAdminUserSummaryDiff(tx)"),
    );
  });

  it("requires the internal metrics token in production", () => {
    const metrics = fs.readFileSync(path.join(process.cwd(), "app/api/internal/admin-metrics/route.ts"), "utf8");
    expect(metrics).toContain('process.env.NODE_ENV === "production"');
    expect(metrics).toContain("INTERNAL_METRICS_TOKEN");
  });

  it("requires an isolated recovery target and verifies free capacity", () => {
    const recovery = fs.readFileSync(path.join(process.cwd(), "scripts/postgres-recovery-drill.sh"), "utf8");
    expect(recovery).toContain("DRILL_CONTAINER must name an isolated PostgreSQL drill container");
    expect(recovery).toContain("ALLOW_SHARED_CLUSTER_DRILL");
    expect(recovery).toContain("source_db_bytes");
    expect(recovery).toContain("available_bytes");
  });

  it("ships approved concurrent indexes for the complete works query and summary ordering", () => {
    const policy = JSON.parse(fs.readFileSync(policyPath, "utf8"));
    const expected = [
      {
        file: "admin-user-summary-active-last-active.sql",
        table: "AdminUserSummary",
        index: "AdminUserSummary_active_lastActiveAt_adminKey_idx",
      },
      {
        file: "admin-work-feed-auth-source-event.sql",
        table: "AdminWorkFeed",
        index: "AdminWorkFeed_authUserId_sourceEventId_active_idx",
      },
      {
        file: "admin-work-feed-user-source-event.sql",
        table: "AdminWorkFeed",
        index: "AdminWorkFeed_userId_sourceEventId_active_idx",
      },
    ];
    expect(policy.approvedOnlineIndexes.map(({ sha256: _sha256, databaseDefinition: _databaseDefinition, ...item }: any) => item)).toEqual(
      expect.arrayContaining(expected),
    );
    for (const item of expected) {
      const approval = policy.approvedOnlineIndexes.find((entry: any) => entry.file === item.file);
      expect(approval?.sha256).toMatch(/^[a-f0-9]{64}$/);
      const sql = fs.readFileSync(path.join(onlineIndexesPath, item.file), "utf8");
      expect(sql).toContain("CREATE INDEX CONCURRENTLY IF NOT EXISTS");
      expect(sql).toContain(`\"${item.index}\"`);
      expect(sql).toContain(`ON \"${item.table}\"`);
      expect(sql).toContain('WHERE "deletedAt" IS NULL');
    }
  });

  it("load-gates the complete works query and the 100k-user summary query", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "scripts", "admin-read-model-load-gate.mjs"), "utf8");
    expect(source).toContain("1_000_000");
    expect(source).toContain("100_000");
    expect(source).toContain('"status" <> \'done\'');
    expect(source).toContain("1_000_001");
    expect(source).toContain("worksP95Ms");
    expect(source).toContain("usersP95Ms");
    expect(source).toContain("sourceWaterScannedRows");
    expect(source).toContain("pageScannedRows");
    expect(source).toContain("summaryScannedRows");
    expect(source).toContain("registeredWorksP95Ms");
    expect(source).toContain("changesP95Ms");
    expect(source).toContain("summaryHighWaterP95Ms");
    expect(source).toContain("summaryChangesP95Ms");
    expect(source).toContain("countUsesSeqScan");
    expect(source).toContain('"type" <> \'import\'');
    expect(source).toContain("sourceWaterP95Ms >= 50");
    expect(source).toContain("worksP95Ms >= 300");
    expect(source).toContain("usersP95Ms >= 200");
  });

  it("backfills lifecycle and summary rows under the worker lease before enabling summary reads", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "scripts", "admin-read-model-backfill.mjs"), "utf8");
    expect(source).toContain("--apply");
    expect(source).toContain("pg_try_advisory_xact_lock");
    expect(source).toContain("worker lease is already held");
    expect(source).toContain('INSERT INTO "AdminWorkFeed"');
    expect(source).toContain('INSERT INTO "AdminUserSummary"');
    expect(source).toContain("admin_user_summary_read_model_diff");
    expect(source).toContain("admin_user_summary_backfill_complete");
    expect(source).toContain("admin_read_model_diff");
  });
});
