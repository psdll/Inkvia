import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ default: {} }));

import {
  DEPLOYMENT_ENV_KEYS,
  runDeploymentHealth,
  type DeploymentHealthInput,
} from "@/lib/deployment-health";

const roots: string[] = [];
const uid = typeof process.getuid === "function" ? process.getuid() : 0;
const gid = typeof process.getgid === "function" ? process.getgid() : 0;
const version = "Inkvia-v2026.07.19.1";
const commit = "a".repeat(40);
const routeIt = process.env.INKVIA_INSTALLER_INNER_MARKER ? it.skip : it;

async function fixture() {
  const root = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "inkvia-deployment-health-")),
  );
  roots.push(root);
  const uploads = path.join(root, "uploads");
  const migrations = path.join(root, "prisma", "migrations");
  await fs.mkdir(path.join(root, "config", "deploy"), { recursive: true });
  await fs.mkdir(uploads, { recursive: true, mode: 0o750 });
  await fs.chmod(uploads, 0o750);
  await fs.mkdir(migrations, { recursive: true });
  const migrationNames = [
    "20260719000000_prefix_z",
    "20260719000000_prefix_\u00e9",
    "20260719000000_prefix_\u4e2d",
  ].sort((left, right) =>
    Buffer.compare(Buffer.from(left), Buffer.from(right)),
  );
  for (const name of migrationNames)
    await fs.mkdir(path.join(migrations, name));
  await fs.writeFile(
    path.join(root, "config", "deploy", "release-metadata.json"),
    `${JSON.stringify({ version, gitCommit: commit })}\n`,
    { mode: 0o644 },
  );
  await fs.writeFile(
    path.join(uploads, ".inkvia-uploads"),
    "INKVIA_UPLOADS_V1\n",
    { mode: 0o640 },
  );
  const env: Record<string, string | undefined> = {
    ADMIN_USERNAME: "administrator",
    ADMIN_PASSWORD: "password-must-never-appear",
    ADMIN_SECRET: "secret-must-never-appear",
    DATABASE_URL:
      "postgresql://credential-must-never-appear@localhost/inkvia",
    UPLOADS_DIR: uploads,
    IMPORTS_DIR: path.join(root, "imports"),
    EXPORTS_DIR: path.join(root, "exports"),
  };
  const queries: string[] = [];
  const db = {
    $queryRaw: async (query: TemplateStringsArray) => {
      const sql = query.join("");
      queries.push(sql);
      if (sql.includes('FROM "_prisma_migrations"')) {
        return migrationNames.map((migration_name) => ({
          migration_name,
          finished_at: new Date("2026-07-19T00:00:00.000Z"),
          rolled_back_at: null,
        }));
      }
      return [{ ok: 1 }];
    },
  };
  const input: DeploymentHealthInput = {
    db,
    env,
    installedRoot: root,
    expectedUploadsPath: uploads,
    expectedUid: uid,
    expectedGid: gid,
    metadataOwnerUid: uid,
  };
  return {
    root,
    uploads,
    migrationNames,
    env,
    db,
    queries,
    input,
  };
}

afterEach(async () => {
  vi.doUnmock("@/lib/deployment-health");
  vi.resetModules();
  await Promise.all(
    roots
      .splice(0)
      .map((root) => fs.rm(root, { recursive: true, force: true })),
  );
});

describe("deployment health", () => {
  it("reads the installed and uploads directories from the service environment", async () => {
    const { root, env, db } = await fixture();
    const result = await runDeploymentHealth({ db, env: { ...env, APP_ROOT_DIR: root }, metadataOwnerUid: uid });
    expect(result.ok).toBe(true);
    expect(result.body.uploads).toBe("OK");
  });

  it("returns exactly the six-key redacted success body after fixed tagged read-only queries", async () => {
    const setup = await fixture();
    const result = await runDeploymentHealth(setup.input);

    expect(result).toEqual({
      ok: true,
      body: {
        version,
        commit,
        database: "OK",
        migrations: "OK",
        environment: Object.fromEntries(
          DEPLOYMENT_ENV_KEYS.map((key) => [key, "SET"]),
        ),
        uploads: "OK",
      },
    });
    expect(Object.keys(result.body)).toEqual([
      "version",
      "commit",
      "database",
      "migrations",
      "environment",
      "uploads",
    ]);
    expect(setup.queries).toHaveLength(2);
    expect(setup.queries[0].trim()).toBe("SELECT 1 AS ok");
    expect(setup.queries[1]).toContain('FROM "_prisma_migrations"');
    expect(setup.queries[1]).toContain('ORDER BY migration_name COLLATE "C"');
    const serialized = JSON.stringify(result.body);
    for (const forbidden of [
      setup.root,
      "password-must-never-appear",
      "secret-must-never-appear",
      "credential-must-never-appear",
      "latency",
      "count",
      "error",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("reports unavailable database and migrations without leaking raw errors", async () => {
    const setup = await fixture();
    const raw = `${setup.root}/postgresql://raw-secret@host/inkvia`;
    setup.input.db = {
      $queryRaw: async () => {
        throw new Error(raw);
      },
    };

    const result = await runDeploymentHealth(setup.input);

    expect(result.ok).toBe(false);
    expect(result.body.database).toBe("UNAVAILABLE");
    expect(result.body.migrations).toBe("UNAVAILABLE");
    expect(JSON.stringify(result.body)).not.toContain(raw);
  });

  it("reports exact migration drift for pending, extra, dirty, rolled-back, or reordered history", async () => {
    type MigrationTestRow = {
      migration_name: string;
      finished_at: Date | null;
      rolled_back_at: Date | null;
    };
    const mutations: Array<{
      name: string;
      apply: (rows: MigrationTestRow[]) => MigrationTestRow[];
    }> = [
      {
        name: "pending",
        apply: (rows) => rows.slice(0, -1),
      },
      {
        name: "extra",
        apply: (rows) => [
          ...rows,
          {
            migration_name: "20260719000000_prefix_\uffff_extra",
            finished_at: new Date("2026-07-19T00:00:00.000Z"),
            rolled_back_at: null,
          },
        ],
      },
      {
        name: "unfinished",
        apply: (rows) =>
          rows.map((row, index) =>
            index === 1 ? { ...row, finished_at: null } : row,
          ),
      },
      {
        name: "rolled-back",
        apply: (rows) =>
          rows.map((row, index) =>
            index === 1
              ? {
                  ...row,
                  rolled_back_at: new Date("2026-07-20T00:00:00.000Z"),
                }
              : row,
          ),
      },
      {
        name: "reversed",
        apply: (rows) => [...rows].reverse(),
      },
    ];

    for (const mutation of mutations) {
      const setup = await fixture();
      const cleanRows: MigrationTestRow[] = setup.migrationNames.map(
        (migration_name) => ({
          migration_name,
          finished_at: new Date("2026-07-19T00:00:00.000Z"),
          rolled_back_at: null,
        }),
      );
      let rows = cleanRows;
      setup.input.db = {
        $queryRaw: async (query: TemplateStringsArray) =>
          query.join("").includes('FROM "_prisma_migrations"')
            ? rows
            : [{ ok: 1 }],
      };
      const clean = await runDeploymentHealth(setup.input);
      expect(clean.body.migrations, `${mutation.name} clean baseline`).toBe(
        "OK",
      );
      expect(clean.ok, `${mutation.name} clean baseline`).toBe(true);

      rows = mutation.apply(cleanRows);
      const drift = await runDeploymentHealth(setup.input);
      expect(drift.body.database, mutation.name).toBe("OK");
      expect(drift.body.migrations, mutation.name).toBe("DRIFT");
      expect(drift.ok, mutation.name).toBe(false);
    }
  });

  it("returns only SET or MISSING for all seven environment keys", async () => {
    const setup = await fixture();
    delete setup.env.ADMIN_SECRET;
    setup.env.ADMIN_PASSWORD = "";

    const result = await runDeploymentHealth(setup.input);

    expect(result.body.environment).toEqual({
      ADMIN_USERNAME: "SET",
      ADMIN_PASSWORD: "MISSING",
      ADMIN_SECRET: "MISSING",
      DATABASE_URL: "SET",
      UPLOADS_DIR: "SET",
      IMPORTS_DIR: "SET",
      EXPORTS_DIR: "SET",
    });
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result.body)).not.toContain("administrator");
  });

  it("fails closed for unsafe release metadata and every uploads contract violation", async () => {
    const metadataCases = [
      { version: "bad", gitCommit: commit },
      { version, gitCommit: "not-a-commit" },
    ];
    for (const metadata of metadataCases) {
      const setup = await fixture();
      await fs.writeFile(
        path.join(setup.root, "config", "deploy", "release-metadata.json"),
        JSON.stringify(metadata),
      );
      const result = await runDeploymentHealth(setup.input);
      expect(result.body.version).toBeNull();
      expect(result.body.commit).toBeNull();
      expect(result.ok).toBe(false);
    }

    const uploadsMutations = [
      async (setup: Awaited<ReturnType<typeof fixture>>) => {
        setup.env.UPLOADS_DIR = path.join(setup.root, "other");
      },
      async (setup: Awaited<ReturnType<typeof fixture>>) => {
        await fs.writeFile(
          path.join(setup.uploads, ".inkvia-uploads"),
          "wrong\n",
        );
      },
    ];
    if (process.platform !== "win32") {
      uploadsMutations.push(
        async (setup: Awaited<ReturnType<typeof fixture>>) => {
          const sentinel = path.join(setup.uploads, ".inkvia-uploads");
          const target = path.join(setup.root, "sentinel-target");
          await fs.writeFile(target, "INKVIA_UPLOADS_V1\n");
          await fs.rm(sentinel);
          await fs.symlink(target, sentinel);
        },
      );
      uploadsMutations.push(
        async (setup: Awaited<ReturnType<typeof fixture>>) => {
          await fs.chmod(setup.uploads, 0o777);
        },
      );
    }
    for (const mutate of uploadsMutations) {
      const setup = await fixture();
      await mutate(setup);
      const result = await runDeploymentHealth(setup.input);
      expect(result.body.uploads).toBe("INVALID");
      expect(result.ok).toBe(false);
      expect(JSON.stringify(result.body)).not.toContain(setup.root);
    }
  });

  it.skipIf(process.platform === "win32")(
    "executes every deployment-health POSIX metadata and uploads branch in a disposable tree",
    async () => {
      const passing = await fixture();
      expect((await runDeploymentHealth(passing.input)).ok).toBe(true);

      const cases: Array<{
        mutate: (setup: Awaited<ReturnType<typeof fixture>>) => Promise<void>;
        expected: "metadata" | "uploads";
      }> = [
        {
          expected: "uploads",
          mutate: async (setup) => {
            const target = path.join(setup.root, "uploads-target");
            await fs.mkdir(target, { mode: 0o750 });
            await fs.writeFile(
              path.join(target, ".inkvia-uploads"),
              "INKVIA_UPLOADS_V1\n",
            );
            await fs.rm(setup.uploads, { recursive: true });
            await fs.symlink(target, setup.uploads, "dir");
          },
        },
        {
          expected: "uploads",
          mutate: async (setup) => fs.chmod(setup.uploads, 0o777),
        },
        {
          expected: "uploads",
          mutate: async (setup) => {
            setup.input.expectedUid = uid + 1;
          },
        },
        {
          expected: "uploads",
          mutate: async (setup) => {
            setup.input.expectedGid = gid + 1;
          },
        },
        {
          expected: "metadata",
          mutate: async (setup) => {
            const metadata = path.join(
              setup.root,
              "config",
              "deploy",
              "release-metadata.json",
            );
            const target = path.join(setup.root, "release-metadata-target");
            await fs.writeFile(
              target,
              `${JSON.stringify({ version, gitCommit: commit })}\n`,
            );
            await fs.rm(metadata);
            await fs.symlink(target, metadata);
          },
        },
        {
          expected: "metadata",
          mutate: async (setup) => {
            await fs.chmod(
              path.join(
                setup.root,
                "config",
                "deploy",
                "release-metadata.json",
              ),
              0o666,
            );
          },
        },
        {
          expected: "metadata",
          mutate: async (setup) => {
            const metadata = path.join(
              setup.root,
              "config",
              "deploy",
              "release-metadata.json",
            );
            if (uid === 0) await fs.chown(metadata, 65534, gid);
            else setup.input.metadataOwnerUid = uid + 1;
          },
        },
        {
          expected: "uploads",
          mutate: async (setup) => {
            await fs.writeFile(
              path.join(setup.uploads, ".inkvia-uploads"),
              "wrong\n",
            );
          },
        },
      ];

      for (const entry of cases) {
        const setup = await fixture();
        await entry.mutate(setup);
        const result = await runDeploymentHealth(setup.input);
        expect(result.ok).toBe(false);
        if (entry.expected === "uploads") {
          expect(result.body.uploads).toBe("INVALID");
        } else {
          expect(result.body.version).toBeNull();
          expect(result.body.commit).toBeNull();
        }
      }
    },
  );

  routeIt(
    "serves only the body with no-store and 200/503 from the separate Node route",
    async () => {
      const body = {
        version,
        commit,
        database: "OK",
        migrations: "OK",
        environment: Object.fromEntries(
          DEPLOYMENT_ENV_KEYS.map((key) => [key, "SET"]),
        ),
        uploads: "OK",
      };
      vi.doMock("@/lib/deployment-health", () => ({
        runDeploymentHealth: vi.fn().mockResolvedValue({ ok: true, body }),
      }));
      const route = await import("@/app/api/health/deployment/route");
      expect(route.runtime).toBe("nodejs");
      expect(route.dynamic).toBe("force-dynamic");
      const success = await route.GET();
      expect(success.status).toBe(200);
      expect(success.headers.get("Cache-Control")).toBe("no-store");
      expect(await success.json()).toEqual(body);

      vi.doUnmock("@/lib/deployment-health");
      vi.resetModules();
      vi.doMock("@/lib/deployment-health", () => ({
        runDeploymentHealth: vi.fn().mockResolvedValue({
          ok: false,
          body: { ...body, uploads: "INVALID" },
        }),
      }));
      const failingRoute = await import("@/app/api/health/deployment/route");
      const failed = await failingRoute.GET();
      expect(failed.status).toBe(503);
      expect(Object.keys(await failed.json())).toEqual(Object.keys(body));
    },
  );
});
