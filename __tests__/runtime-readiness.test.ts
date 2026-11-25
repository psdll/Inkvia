import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  READINESS_UPLOADS_SENTINEL,
  READINESS_UPLOADS_SENTINEL_CONTENT,
  runReadinessChecks,
} from "@/lib/runtime-readiness";

const roots: string[] = [];

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "inkvia-readiness-"));
  roots.push(root);
  const uploads = path.join(root, "uploads");
  const migrations = path.join(root, "migrations");
  await fs.mkdir(path.join(uploads, "_thumbs"), { recursive: true });
  await fs.mkdir(path.join(migrations, "20260716090000_ready"), { recursive: true });
  await fs.writeFile(path.join(uploads, READINESS_UPLOADS_SENTINEL), READINESS_UPLOADS_SENTINEL_CONTENT);
  return { root, uploads, migrations };
}

function dbFixture(options: { heartbeatAgeMs?: number; oldestEventAgeMs?: number; migrations?: string[] } = {}) {
  const now = new Date("2026-07-16T12:00:00.000Z");
  const heartbeatAt = new Date(now.getTime() - (options.heartbeatAgeMs ?? 10_000)).toISOString();
  const oldest = new Date(now.getTime() - (options.oldestEventAgeMs ?? 5_000));
  return {
    now,
    db: {
      $queryRawUnsafe: async (sql: string) => {
        if (sql.includes('Generation_requestKey_key')) {
          return [{ index_ready: true, duplicate_groups: BigInt(0) }];
        }
        if (sql.includes('FROM "_prisma_migrations"')) {
          return (options.migrations || ["20260716090000_ready"]).map((migration_name) => ({
            migration_name,
            finished_at: now,
            rolled_back_at: null,
          }));
        }
        if (sql.includes('FROM "AdminEvent"')) {
          return [{ backlog_count: BigInt(2), oldest_at: oldest, exhausted_count: BigInt(0) }];
        }
        return [{ ok: 1 }];
      },
      appSetting: {
        findUnique: async ({ where }: any) => {
          if (where.key === "admin_event_worker_heartbeat") {
            return { value: JSON.stringify({ successAt: heartbeatAt }) };
          }
          if (where.key === "admin_read_model_diff") {
            return { value: JSON.stringify({ count: 0, checkedAt: heartbeatAt, zeroSince: "2026-07-15T12:00:00.000Z" }) };
          }
          if (where.key === "admin_user_summary_read_model_diff") {
            return { value: JSON.stringify({ count: 0, checkedAt: heartbeatAt }) };
          }
          return null;
        },
      },
    },
  };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("runtime readiness", () => {
  it("passes only when database, mount, thumb directory, migrations and worker are ready", async () => {
    const paths = await fixture();
    const { db, now } = dbFixture();
    const report = await runReadinessChecks({
      db,
      now,
      env: {
        NODE_ENV: "production",
        UPLOADS_DIR: paths.uploads,
        ADMIN_WORKS_READ_MODEL: "1",
        ADMIN_SUMMARY_READ_MODEL: "1",
      },
      migrationsRoot: paths.migrations,
    });

    expect(report.ready).toBe(true);
    expect(report.checks).toEqual(expect.objectContaining({
      database: expect.objectContaining({ status: "ok" }),
      uploadsMount: expect.objectContaining({ status: "ok" }),
      uploadsWritable: expect.objectContaining({ status: "ok" }),
      thumbnailDirectory: expect.objectContaining({ status: "ok" }),
      migrations: expect.objectContaining({ status: "ok" }),
      generationRequestKey: expect.objectContaining({
        status: "ok",
        indexReady: true,
        duplicateGroups: 0,
      }),
      workerHeartbeat: expect.objectContaining({ status: "ok" }),
      eventBacklog: expect.objectContaining({ status: "ok", backlog: 2 }),
      readModelDiff: expect.objectContaining({ status: "ok", count: 0 }),
      userSummaryDiff: expect.objectContaining({ status: "ok", count: 0 }),
    }));
  });

  it("checks persistent directory access without changing directory timestamps", async () => {
    const paths = await fixture();
    const thumbnailDirectory = path.join(paths.uploads, "_thumbs");
    const timestamp = new Date("2026-01-01T00:00:00.000Z");
    await fs.utimes(paths.uploads, timestamp, timestamp);
    await fs.utimes(thumbnailDirectory, timestamp, timestamp);
    const uploadsBefore = await fs.stat(paths.uploads);
    const thumbnailsBefore = await fs.stat(thumbnailDirectory);
    const { db, now } = dbFixture();

    const report = await runReadinessChecks({
      db,
      now,
      env: { NODE_ENV: "production", UPLOADS_DIR: paths.uploads },
      migrationsRoot: paths.migrations,
    });

    expect(report.ready).toBe(true);
    expect((await fs.stat(paths.uploads)).mtimeMs).toBe(uploadsBefore.mtimeMs);
    expect((await fs.stat(thumbnailDirectory)).mtimeMs).toBe(thumbnailsBefore.mtimeMs);
  });

  it("fails a missing production sentinel without creating an empty uploads directory", async () => {
    const paths = await fixture();
    await fs.rm(paths.uploads, { recursive: true });
    const { db, now } = dbFixture();
    const report = await runReadinessChecks({
      db,
      now,
      env: { NODE_ENV: "production", UPLOADS_DIR: paths.uploads },
      migrationsRoot: paths.migrations,
    });

    expect(report.ready).toBe(false);
    expect(report.checks.uploadsMount.status).toBe("error");
    expect(report.checks.uploadsMount).toMatchObject({ code: "UPLOADS_MOUNT_UNAVAILABLE" });
    expect(JSON.stringify(report)).not.toContain(paths.root);
    await expect(fs.stat(paths.uploads)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("fails stale worker heartbeat, old events, migration drift and read-model differences", async () => {
    const paths = await fixture();
    await fs.mkdir(path.join(paths.migrations, "20260716100000_pending"));
    const { db, now } = dbFixture({ heartbeatAgeMs: 121_000, oldestEventAgeMs: 31_000 });
    db.appSetting.findUnique = async ({ where }: any) => where.key === "admin_event_worker_heartbeat"
      ? { value: JSON.stringify({ successAt: new Date(now.getTime() - 121_000).toISOString() }) }
      : { value: JSON.stringify({ count: 1, checkedAt: now.toISOString() }) };

    const report = await runReadinessChecks({
      db,
      now,
      env: {
        NODE_ENV: "production",
        UPLOADS_DIR: paths.uploads,
        ADMIN_WORKS_READ_MODEL: "1",
        ADMIN_SUMMARY_READ_MODEL: "1",
      },
      migrationsRoot: paths.migrations,
    });

    expect(report.ready).toBe(false);
    expect(report.checks.workerHeartbeat.status).toBe("error");
    expect(report.checks.eventBacklog.status).toBe("error");
    expect(report.checks.migrations.status).toBe("error");
    expect(report.checks.readModelDiff.status).toBe("error");
  });

  it("fails production readiness when generation request-key uniqueness is not enforced", async () => {
    const paths = await fixture();
    const { db, now } = dbFixture();
    const originalQuery = db.$queryRawUnsafe;
    db.$queryRawUnsafe = async (sql: string) => sql.includes('Generation_requestKey_key')
      ? [{ index_ready: false, duplicate_groups: BigInt(3) }]
      : originalQuery(sql);

    const report = await runReadinessChecks({
      db,
      now,
      env: { NODE_ENV: "production", UPLOADS_DIR: paths.uploads },
      migrationsRoot: paths.migrations,
    });

    expect(report.ready).toBe(false);
    expect(report.checks.generationRequestKey).toMatchObject({
      status: "error",
      code: "GENERATION_REQUEST_KEY_UNSAFE",
    });
  });

  it("fails production readiness for exhausted events or a missing diff snapshot", async () => {
    const paths = await fixture();
    const { db, now } = dbFixture();
    const originalQuery = db.$queryRawUnsafe;
    db.$queryRawUnsafe = async (sql: string) => sql.includes('FROM "AdminEvent"')
      ? [{ backlog_count: BigInt(1), oldest_at: now, exhausted_count: BigInt(1) }]
      : originalQuery(sql);
    db.appSetting.findUnique = async ({ where }: any) => where.key === "admin_event_worker_heartbeat"
      ? { value: JSON.stringify({ successAt: now.toISOString() }) }
      : null;

    const report = await runReadinessChecks({
      db,
      now,
      env: {
        NODE_ENV: "production",
        UPLOADS_DIR: paths.uploads,
        ADMIN_WORKS_READ_MODEL: "1",
        ADMIN_SUMMARY_READ_MODEL: "1",
      },
      migrationsRoot: paths.migrations,
    });

    expect(report.ready).toBe(false);
    expect(report.checks.eventBacklog).toMatchObject({ status: "error", code: "ADMIN_EVENT_BACKLOG_UNHEALTHY" });
    expect(report.checks.readModelDiff).toMatchObject({ status: "error", code: "READ_MODEL_DIFF_UNVERIFIED" });
    expect(report.checks.userSummaryDiff).toMatchObject({ status: "error", code: "USER_SUMMARY_DIFF_UNVERIFIED" });
  });

  it("requires a complete zero-diff observation window before the works read model can be enabled", async () => {
    const paths = await fixture();
    const { db, now } = dbFixture();
    db.appSetting.findUnique = async ({ where }: any) => {
      if (where.key === "admin_event_worker_heartbeat") {
        return { value: JSON.stringify({ successAt: now.toISOString() }) };
      }
      if (where.key === "admin_read_model_diff") {
        return { value: JSON.stringify({ count: 0, checkedAt: now.toISOString(), zeroSince: now.toISOString() }) };
      }
      if (where.key === "admin_user_summary_read_model_diff") {
        return { value: JSON.stringify({ count: 0, checkedAt: now.toISOString() }) };
      }
      return null;
    };

    const report = await runReadinessChecks({
      db,
      now,
      env: {
        NODE_ENV: "production",
        UPLOADS_DIR: paths.uploads,
        ADMIN_WORKS_READ_MODEL: "1",
        ADMIN_READ_MODEL_ZERO_WINDOW_MS: String(24 * 60 * 60_000),
      },
      migrationsRoot: paths.migrations,
    });

    expect(report.ready).toBe(false);
    expect(report.checks.readModelDiff).toMatchObject({ status: "error", code: "READ_MODEL_DIFF_UNVERIFIED" });
  });

  it("does not require historical projection snapshots while both read models are disabled", async () => {
    const paths = await fixture();
    const { db, now } = dbFixture();
    db.appSetting.findUnique = async ({ where }: any) => where.key === "admin_event_worker_heartbeat"
      ? { value: JSON.stringify({ successAt: now.toISOString() }) }
      : null;
    const report = await runReadinessChecks({
      db,
      now,
      env: { NODE_ENV: "production", UPLOADS_DIR: paths.uploads },
      migrationsRoot: paths.migrations,
    });
    expect(report.ready).toBe(true);
    expect(report.checks.readModelDiff).toMatchObject({ status: "ok", enabled: false, measured: false });
    expect(report.checks.userSummaryDiff).toMatchObject({ status: "ok", enabled: false, measured: false });
  });

  it("reports disabled projection readers as unmeasured even with persisted snapshots", async () => {
    const paths = await fixture();
    const { db, now } = dbFixture();
    const report = await runReadinessChecks({
      db,
      now,
      env: { NODE_ENV: "production", UPLOADS_DIR: paths.uploads },
      migrationsRoot: paths.migrations,
    });
    expect(report.ready).toBe(true);
    expect(report.checks.readModelDiff).toMatchObject({ status: "ok", enabled: false, measured: false });
    expect(report.checks.userSummaryDiff).toMatchObject({ status: "ok", enabled: false, measured: false });
  });

  it("requires verified snapshots when projection readers are explicitly enabled", async () => {
    const paths = await fixture();
    const { db, now } = dbFixture();
    db.appSetting.findUnique = async ({ where }: any) => where.key === "admin_event_worker_heartbeat"
      ? { value: JSON.stringify({ successAt: now.toISOString() }) }
      : null;
    const report = await runReadinessChecks({
      db,
      now,
      env: {
        NODE_ENV: "production",
        UPLOADS_DIR: paths.uploads,
        ADMIN_WORKS_READ_MODEL: "1",
        ADMIN_SUMMARY_READ_MODEL: "1",
      },
      migrationsRoot: paths.migrations,
    });
    expect(report.ready).toBe(false);
    expect(report.checks.readModelDiff.status).toBe("error");
    expect(report.checks.userSummaryDiff.status).toBe("error");
  });
});
