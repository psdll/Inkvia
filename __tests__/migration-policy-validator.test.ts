import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

import { validateMigrationPolicy } from "@/scripts/validate-migration-policy.mjs";

const approvedSql = 'CREATE INDEX CONCURRENTLY IF NOT EXISTS "Generation_createdAt_idx" ON "Generation"("createdAt");';
const canonicalHash = (sql: string) => crypto.createHash("sha256")
  .update(sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--.*$/gm, " ").trim().replace(/\s+/g, " ").replace(/;$/, ""))
  .digest("hex");
const migrationHash = (sql: string) => crypto.createHash("sha256")
  .update(sql.replace(/\r\n?/g, "\n"))
  .digest("hex");

const policy = {
  version: 5,
  allowDestructiveMigration: false,
  largeTables: ["Generation", "AdminEvent", "AdminWorkFeed"],
  approvedOnlineIndexes: [
    {
      file: "generation-created-at.sql",
      table: "Generation",
      index: "Generation_createdAt_idx",
      sha256: canonicalHash(approvedSql),
      databaseDefinition: 'CREATE INDEX "Generation_createdAt_idx" ON public."Generation" USING btree ("createdAt")',
    },
  ],
};

const declaration = (
  name: string,
  sql: string,
  overrides: Record<string, unknown> = {},
) => ({
  name,
  sha256: migrationHash(sql),
  class: "expand",
  execution: "automatic",
  historicalRowWrites: false,
  oldCodeCompatible: true,
  ...overrides,
});
describe("migration policy validator", () => {
  it("rejects destructive pending migrations", () => {
    for (const [sql, operation] of [
      ['DROP TABLE "Generation";', "DROP"],
      ['ALTER TABLE "Generation" RENAME COLUMN "status" TO "state";', "RENAME"],
      ['ALTER TABLE "Generation" ALTER COLUMN "status" TYPE text;', "ALTER COLUMN TYPE"],
      ['DELETE FROM "Generation";', "DELETE"],
    ]) {
      const result = validateMigrationPolicy({
        policy,
        pendingMigrations: [{ name: "danger", sql }],
        onlineIndexes: [],
      });
      expect(result.errors).toContain(operation);
      expect(result.errors.join(" ")).toMatch(/destructive/i);
    }
  });

  it("allows only exact-hash approved same-name constraint replacements", () => {
    const sql = `BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
ALTER TABLE "MediaReference"
  DROP CONSTRAINT "MediaReference_sourceType_check";
ALTER TABLE "MediaReference"
  ADD CONSTRAINT "MediaReference_sourceType_check" CHECK ("sourceType" IN ('library', 'batch_workspace'));
COMMIT;`;
    const approvedPolicy = {
      ...policy,
      approvedOnlineIndexes: [],
      approvedSchemaMigrations: [{ name: "constraint-replacement", sha256: migrationHash(sql) }],
    };

    expect(validateMigrationPolicy({
      policy: approvedPolicy,
      pendingMigrations: [{ name: "constraint-replacement", sql }],
      onlineIndexes: [],
    }).errors).toEqual([]);

    const destructiveSql = 'DROP TABLE "MediaReference";';
    expect(validateMigrationPolicy({
      policy: {
        ...approvedPolicy,
        approvedSchemaMigrations: [{
          name: "constraint-replacement",
          sha256: migrationHash(destructiveSql),
        }],
      },
      pendingMigrations: [{ name: "constraint-replacement", sql: destructiveSql }],
      onlineIndexes: [],
    }).errors.join(" ")).toMatch(/destructive migration blocked/i);
  });

  it("accepts only additive Prisma migration statements", () => {
    const sql = [
      'CREATE TYPE "Visibility" AS ENUM (\'private\', \'public\')',
      'CREATE TABLE "NewFeatureData" ("id" SERIAL NOT NULL, CONSTRAINT "NewFeatureData_pkey" PRIMARY KEY ("id"))',
      'ALTER TABLE "User" ADD COLUMN "displayName" TEXT',
      'ALTER TABLE "NewFeatureData" ADD CONSTRAINT "NewFeatureData_userId_fkey" FOREIGN KEY ("id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE',
      'CREATE INDEX "NewFeatureData_id_idx" ON "NewFeatureData"("id")',
    ].join(";\n");

    const result = validateMigrationPolicy({
      policy: { ...policy, approvedOnlineIndexes: [] },
      pendingMigrations: [{ name: "additive", sql }],
      onlineIndexes: [],
    });

    expect(result.errors).toEqual([]);
  });

  it("rejects data-producing CREATE TABLE statements", () => {
    for (const sql of [
      'CREATE TABLE "CopiedUser" AS SELECT * FROM "User"',
      'CREATE TABLE "SeededValue" AS VALUES (1)',
      'CREATE TABLE "CopiedUser" AS (WITH source AS (SELECT 1) SELECT * FROM source)',
    ]) {
      const result = validateMigrationPolicy({
        policy: { ...policy, approvedOnlineIndexes: [] },
        pendingMigrations: [{ name: "data-producing-table", sql }],
        onlineIndexes: [],
      });
      expect(result.errors.join(" ")).toMatch(/data-producing CREATE TABLE/i);
    }
  });

  it("rejects top-level DML and unknown executable SQL", () => {
    for (const sql of [
      'UPDATE "User" SET "username" = \'x\'',
      'DO $$ BEGIN DELETE FROM "User"; END $$',
      'COPY "User" FROM PROGRAM \'sh -c dangerous\'',
    ]) {
      const result = validateMigrationPolicy({
        policy: { ...policy, approvedOnlineIndexes: [] },
        pendingMigrations: [{ name: "blocked", sql }],
        onlineIndexes: [],
      });
      expect(result.errors.join(" ")).toMatch(/blocked|unknown|destructive/i);
    }
  });

  it("allows approved future-write function bodies while rejecting top-level DML", () => {
    const sql = `CREATE OR REPLACE FUNCTION mutate() RETURNS trigger AS $$
BEGIN
  DELETE FROM "User";
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;`;
    const approvedPolicy = {
      ...policy,
      approvedOnlineIndexes: [],
      approvedSchemaMigrations: [{ name: "future-write", sha256: migrationHash(sql) }],
    };

    expect(validateMigrationPolicy({
      policy: approvedPolicy,
      pendingMigrations: [{ name: "future-write", sql }],
      onlineIndexes: [],
    }).errors).toEqual([]);
    expect(validateMigrationPolicy({
      policy: approvedPolicy,
      pendingMigrations: [{ name: "future-write", sql: `${sql}\nINSERT INTO "User" (id) VALUES (1);` }],
      onlineIndexes: [],
    }).errors).toContain("top-level INSERT");
  });

  it("rejects a required column on an existing table without a default", () => {
    const result = validateMigrationPolicy({
      policy: { ...policy, approvedOnlineIndexes: [] },
      pendingMigrations: [{
        name: "unsafe-required-column",
        sql: 'ALTER TABLE "User" ADD COLUMN "externalId" TEXT NOT NULL;',
      }],
      onlineIndexes: [],
    });

    expect(result.errors.join(" ")).toMatch(/not null.*default/i);
  });

  it("allows additive defaults without historical-row-write approvals", () => {
    for (const sql of [
      'ALTER TABLE "User" ADD COLUMN "nonce" DOUBLE PRECISION DEFAULT random()',
      'ALTER TABLE "User" ADD COLUMN "status" TEXT DEFAULT \'new\'',
      'ALTER TABLE IF EXISTS ONLY "public"."User" ADD COLUMN "createdAt" TIMESTAMP DEFAULT now()',
    ]) {
      const result = validateMigrationPolicy({
        policy: { ...policy, approvedOnlineIndexes: [] },
        pendingMigrations: [{ name: "historical-row-write", sql }],
        onlineIndexes: [],
      });
      expect(result.errors).toEqual([]);
    }

    const sql = 'ALTER TABLE "User" ADD COLUMN "nonce" DOUBLE PRECISION DEFAULT random()';
    expect(validateMigrationPolicy({
      policy: {
        ...policy,
        approvedOnlineIndexes: [],
      },
      pendingMigrations: [{ name: "reviewed", sql }],
      onlineIndexes: [],
    }).errors).toEqual([]);
  });

  it("rejects ordinary indexes on configured large tables", () => {
    const result = validateMigrationPolicy({
      policy,
      pendingMigrations: [{
        name: "blocking-index",
        sql: 'CREATE INDEX "Generation_createdAt_idx" ON "Generation"("createdAt");',
      }],
      onlineIndexes: [],
    });
    expect(result.errors.join(" ")).toMatch(/large table.*concurrently/i);

    const qualified = validateMigrationPolicy({
      policy,
      pendingMigrations: [{
        name: "qualified-blocking-index",
        sql: 'CREATE INDEX "Generation_createdAt_idx" ON ONLY "public"."Generation"("createdAt");',
      }],
      onlineIndexes: [],
    });
    expect(qualified.errors.join(" ")).toMatch(/large table.*concurrently/i);
  });

  it("allows ordinary indexes only on large tables created in the same pending batch", () => {
    const createdHere = validateMigrationPolicy({
      policy: { ...policy, approvedOnlineIndexes: [] },
      pendingMigrations: [
        { name: "001_create", sql: 'CREATE TABLE "AdminEvent" ("id" SERIAL PRIMARY KEY);' },
        { name: "002_index", sql: 'CREATE INDEX "AdminEvent_id_idx" ON "AdminEvent"("id");' },
      ],
      onlineIndexes: [],
    });
    expect(createdHere.errors).toEqual([]);

    const existingTable = validateMigrationPolicy({
      policy: { ...policy, approvedOnlineIndexes: [] },
      pendingMigrations: [
        { name: "002_index", sql: 'CREATE INDEX "AdminEvent_id_idx" ON "AdminEvent"("id");' },
      ],
      onlineIndexes: [],
    });
    expect(existingTable.errors.join(" ")).toMatch(/large table.*concurrently/i);
  });

  it("reports the verified CREATE TABLE inventory per pending migration", () => {
    const result = validateMigrationPolicy({
      policy: { ...policy, approvedOnlineIndexes: [] },
      pendingMigrations: [
        { name: "001_first", sql: 'CREATE TABLE "FirstTable" ("id" TEXT PRIMARY KEY);' },
        { name: "002_second", sql: 'COMMENT ON TABLE "FirstTable" IS \'reviewed\';\nCREATE TABLE public."SecondTable" ("id" TEXT);' },
      ],
      onlineIndexes: [],
    });
    expect(result.errors).toEqual([]);
    expect(result.migrations).toEqual([
      { name: "001_first", createdTables: [{ schema: "public", table: "FirstTable" }] },
      { name: "002_second", createdTables: [{ schema: "public", table: "SecondTable" }] },
    ]);
  });

  it("is invariant to same-batch migration order for new-table indexes and defaults", () => {
    const migrations = [
      { name: "001_create", sql: 'CREATE TABLE "AdminEvent" ("id" SERIAL PRIMARY KEY);' },
      { name: "002_default", sql: 'ALTER TABLE "AdminEvent" ADD COLUMN "createdAt" TIMESTAMP NOT NULL DEFAULT now();' },
      { name: "003_index", sql: 'CREATE INDEX "AdminEvent_createdAt_idx" ON "AdminEvent"("createdAt");' },
    ];
    for (const pendingMigrations of [
      migrations,
      [...migrations].reverse(),
      [migrations[1], migrations[0], migrations[2]],
    ]) {
      expect(validateMigrationPolicy({
        policy: { ...policy, approvedOnlineIndexes: [] },
        pendingMigrations,
        onlineIndexes: [],
      }).errors).toEqual([]);
    }
  });

  it("does not treat IF NOT EXISTS as proof that a table is new in this batch", () => {
    const result = validateMigrationPolicy({
      policy: { ...policy, approvedOnlineIndexes: [] },
      pendingMigrations: [{
        name: "uncertain-create",
        sql: [
          'CREATE TABLE IF NOT EXISTS "AdminEvent" ("id" SERIAL PRIMARY KEY)',
          'ALTER TABLE "AdminEvent" ADD COLUMN "nonce" DOUBLE PRECISION DEFAULT random()',
          'CREATE INDEX "AdminEvent_nonce_idx" ON "AdminEvent"("nonce")',
        ].join(";\n"),
      }],
      onlineIndexes: [],
    });
    expect(result.errors.join(" ")).toMatch(/large table.*concurrently/i);
  });

  it("ignores fake CREATE TABLE text in comments, strings, dollar bodies, and quoted identifiers", () => {
    const fakeCreatePrefixes = [
      'COMMENT ON TABLE "User" IS \'CREATE TABLE "User" ("id" INTEGER)\'',
      'CREATE TABLE "AuditText" ("note" TEXT DEFAULT \'CREATE TABLE "User" ("id" INTEGER)\')',
      'DO $$ BEGIN RAISE NOTICE \'CREATE TABLE "User" ("id" INTEGER)\'; END $$',
      'CREATE TABLE "AuditColumn" ("CREATE TABLE ""User""" TEXT)',
    ];
    for (const prefix of fakeCreatePrefixes) {
      const result = validateMigrationPolicy({
        policy: { ...policy, approvedOnlineIndexes: [] },
        pendingMigrations: [{
          name: "fake-create-text",
          sql: `${prefix};\nALTER TABLE "public"."User" ADD COLUMN "nonce" DOUBLE PRECISION DEFAULT random();`,
        }],
        onlineIndexes: [],
      });
      if (prefix.startsWith("DO $$")) {
        expect(result.errors.join(" "), prefix).toMatch(/blocked dollar-quoted executable migration body/i);
      } else {
        expect(result.errors, prefix).toEqual([]);
      }
    }
  });

  it("keeps scratch and public table identities distinct", () => {
    const result = validateMigrationPolicy({
      policy: { ...policy, approvedOnlineIndexes: [] },
      pendingMigrations: [{
        name: "cross-schema-name",
        sql: [
          'CREATE TABLE "scratch"."User" ("id" SERIAL PRIMARY KEY)',
          'CREATE TABLE "scratch"."AdminEvent" ("id" SERIAL PRIMARY KEY)',
          'ALTER TABLE "public"."User" ADD COLUMN "nonce" DOUBLE PRECISION DEFAULT random()',
          'CREATE INDEX "AdminEvent_id_idx" ON "public"."AdminEvent"("id")',
        ].join(";\n"),
      }],
      onlineIndexes: [],
    });
    expect(result.errors.join(" ")).toMatch(/large table.*concurrently/i);
  });

  it("rejects nested-parenthesis CTAS with an optional column-name list", () => {
    const result = validateMigrationPolicy({
      policy: { ...policy, approvedOnlineIndexes: [] },
      pendingMigrations: [{
        name: "nested-ctas",
        sql: 'CREATE TABLE "CopiedUser" ("id") AS ((SELECT "id" FROM "User"));',
      }],
      onlineIndexes: [],
    });
    expect(result.errors.join(" ")).toMatch(/data-producing CREATE TABLE/i);
  });

  it("allows a safe column string default containing AS SELECT", () => {
    const result = validateMigrationPolicy({
      policy: { ...policy, approvedOnlineIndexes: [] },
      pendingMigrations: [{
        name: "safe-string-default",
        sql: 'CREATE TABLE "SafeString" ("value" TEXT DEFAULT \'AS SELECT\');',
      }],
      onlineIndexes: [],
    });
    expect(result.errors).toEqual([]);
  });

  it("does not split statements or comments inside single-quoted strings", () => {
    const result = validateMigrationPolicy({
      policy: { ...policy, approvedOnlineIndexes: [] },
      pendingMigrations: [{
        name: "string-markers",
        sql: `CREATE TABLE "SafeMarkers" (
          "value" TEXT DEFAULT 'semi; -- not a comment
/* also not a comment */ still one string'
        );`,
      }],
      onlineIndexes: [],
    });
    expect(result.errors).toEqual([]);
  });

  it("treats backslash as ordinary text in a plain PostgreSQL string", () => {
    const result = validateMigrationPolicy({
      policy: { ...policy, approvedOnlineIndexes: [] },
      pendingMigrations: [{
        name: "plain-string-backslash",
        sql: String.raw`COMMENT ON TABLE "User" IS 'x\'; ALTER TABLE public.User ADD COLUMN nonce DOUBLE PRECISION DEFAULT random(); --'`,
      }],
      onlineIndexes: [],
    });
    expect(result.errors).toEqual([]);
  });

  it("keeps escaped quotes and semicolons inside an explicit PostgreSQL E-string", () => {
    const result = validateMigrationPolicy({
      policy: { ...policy, approvedOnlineIndexes: [] },
      pendingMigrations: [{
        name: "escape-string",
        sql: String.raw`CREATE TABLE "SafeEscape" ("value" TEXT DEFAULT E'escaped quote: \'; semicolon; -- still a string');`,
      }],
      onlineIndexes: [],
    });
    expect(result.errors).toEqual([]);
  });

  it("does not infer an E-string prefix from an identifier ending in E", () => {
    const result = validateMigrationPolicy({
      policy: { ...policy, approvedOnlineIndexes: [] },
      pendingMigrations: [{
        name: "identifier-ending-e",
        sql: String.raw`COMMENT ON TABLE "User" IS SOME'x\'; ALTER TABLE public.User ADD COLUMN nonce DOUBLE PRECISION DEFAULT random(); --'`,
      }],
      onlineIndexes: [],
    });
    expect(result.errors).toEqual([]);
  });

  it("fails closed on unsupported PostgreSQL U& string prefixes", () => {
    const result = validateMigrationPolicy({
      policy: { ...policy, approvedOnlineIndexes: [] },
      pendingMigrations: [{
        name: "unsupported-unicode-string",
        sql: String.raw`COMMENT ON TABLE "User" IS U&'x\'; ALTER TABLE public.User ADD COLUMN nonce DOUBLE PRECISION DEFAULT random(); --'`,
      }],
      onlineIndexes: [],
    });
    expect(result.errors.join(" ")).toMatch(/unsupported PostgreSQL string prefix/i);
  });

  it("does not use historical-row-write approvals for existing-table defaults", () => {
    const sql = 'ALTER TABLE "Canvas" ALTER COLUMN "title" SET DEFAULT \'Untitled\';';
    expect(validateMigrationPolicy({
      policy: { ...policy, approvedOnlineIndexes: [] },
      pendingMigrations: [{ name: "canvas-default", sql }],
      onlineIndexes: [],
    }).errors).toEqual([]);
    expect(validateMigrationPolicy({
      policy: { ...policy, approvedOnlineIndexes: [] },
      pendingMigrations: [{ name: "canvas-default", sql: `${sql}\n-- changed` }],
      onlineIndexes: [],
    }).errors).toEqual([]);
  });

  it("requires name and exact LF-normalized hash for trigger migrations", () => {
    const sql = `CREATE OR REPLACE FUNCTION "enqueue_generation_admin_event"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO "AdminEvent" ("eventType") VALUES ('generation.insert');
  RETURN NEW;
END;
$$;
CREATE TRIGGER "Generation_admin_event_trigger"
AFTER INSERT ON "Generation" FOR EACH ROW
EXECUTE FUNCTION "enqueue_generation_admin_event"();`;
    const approvedPolicy = {
      ...policy,
      approvedOnlineIndexes: [],
      approvedSchemaMigrations: [{ name: "trigger", sha256: migrationHash(sql) }],
    };
    expect(validateMigrationPolicy({
      policy: approvedPolicy,
      pendingMigrations: [{ name: "trigger", sql }],
      onlineIndexes: [],
    }).errors).toEqual([]);
    expect(validateMigrationPolicy({
      policy: approvedPolicy,
      pendingMigrations: [{ name: "trigger", sql: `${sql}\n-- changed` }],
      onlineIndexes: [],
    }).errors.join(" ")).toMatch(/schema migration.*approval/i);
    expect(validateMigrationPolicy({
      policy: approvedPolicy,
      pendingMigrations: [{ name: "unapproved-trigger", sql }],
      onlineIndexes: [],
    }).errors.join(" ")).toMatch(/schema migration.*approval/i);
  });

  it("still rejects top-level DML even when an executable schema file is approved", () => {
    const sql = `CREATE OR REPLACE FUNCTION "f"() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN RETURN NEW; END;
$$;
UPDATE "User" SET "username" = 'changed';`;
    const result = validateMigrationPolicy({
      policy: {
        ...policy,
        approvedOnlineIndexes: [],
        approvedSchemaMigrations: [{ name: "bad", sha256: migrationHash(sql) }],
      },
      pendingMigrations: [{ name: "bad", sql }],
      onlineIndexes: [],
    });
    expect(result.errors.join(" ")).toMatch(/top-level data mutation/i);
  });

  it("accepts only explicitly approved independent concurrent indexes", () => {
    const result = validateMigrationPolicy({
      policy,
      pendingMigrations: [],
      onlineIndexes: [{
        file: "generation-created-at.sql",
        sql: approvedSql,
      }],
    });
    expect(result.errors).toEqual([]);
    expect(result.onlineIndexes).toEqual(["generation-created-at.sql"]);
  });

  it("rejects an online index file containing any additional statement", () => {
    const result = validateMigrationPolicy({
      policy,
      pendingMigrations: [],
      onlineIndexes: [{
        file: "generation-created-at.sql",
        sql: 'CREATE INDEX CONCURRENTLY "Generation_createdAt_idx" ON "Generation"("createdAt"); DELETE FROM "Generation";',
      }],
    });
    expect(result.errors.join(" ")).toMatch(/one CREATE INDEX CONCURRENTLY/i);
  });

  it("rejects a non-idempotent online index", () => {
    const result = validateMigrationPolicy({
      policy,
      pendingMigrations: [],
      onlineIndexes: [{
        file: "generation-created-at.sql",
        sql: 'CREATE INDEX CONCURRENTLY "Generation_createdAt_idx" ON "Generation"("createdAt");',
      }],
    });
    expect(result.errors.join(" ")).toMatch(/one CREATE INDEX CONCURRENTLY/i);
  });

  it("rejects a same-name online index whose columns or predicate differ from approval", () => {
    const result = validateMigrationPolicy({
      policy,
      pendingMigrations: [],
      onlineIndexes: [{
        file: "generation-created-at.sql",
        sql: 'CREATE INDEX CONCURRENTLY IF NOT EXISTS "Generation_createdAt_idx" ON "Generation"("updatedAt");',
      }],
    });
    expect(result.errors.join(" ")).toMatch(/definition.*approval/i);
  });

  it("fails closed when the CLI has no --applied file", () => {
    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), "migration-policy-cli-"),
    );
    const migrations = path.join(root, "migrations");
    const online = path.join(root, "online");
    fs.mkdirSync(migrations);
    fs.mkdirSync(online);
    fs.writeFileSync(
      path.join(root, "policy.json"),
      JSON.stringify({
        ...policy,
        approvedOnlineIndexes: [],
      }),
    );
    try {
      expect(() =>
        execFileSync(
          process.execPath,
          [
            path.join(
              process.cwd(),
              "scripts",
              "validate-migration-policy.mjs",
            ),
            "--policy",
            path.join(root, "policy.json"),
            "--migrations",
            migrations,
            "--online-indexes",
            online,
          ],
          { stdio: "pipe" },
        ),
      ).toThrow();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("sorts CLI migration directories deterministically", () => {
    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), "migration-policy-cli-order-"),
    );
    const migrations = path.join(root, "migrations");
    const online = path.join(root, "online");
    fs.mkdirSync(migrations);
    fs.mkdirSync(online);
    fs.writeFileSync(
      path.join(root, "policy.json"),
      JSON.stringify({
        ...policy,
        approvedOnlineIndexes: [],
        migrations: [
          declaration("001_first", "COMMENT ON TABLE \"User\" IS '001_first';"),
          declaration(
            "002_middle",
            "COMMENT ON TABLE \"User\" IS '002_middle';",
          ),
          declaration("003_last", "COMMENT ON TABLE \"User\" IS '003_last';"),
        ],
      }),
    );
    for (const name of ["003_last", "001_first", "002_middle"]) {
      const directory = path.join(migrations, name);
      fs.mkdirSync(directory);
      fs.writeFileSync(
        path.join(directory, "migration.sql"),
        `COMMENT ON TABLE "User" IS '${name}';`,
      );
    }
    const applied = path.join(root, "applied.txt");
    fs.writeFileSync(applied, "001_first\n");
    try {
      const stdout = execFileSync(
        process.execPath,
        [
          path.join(process.cwd(), "scripts", "validate-migration-policy.mjs"),
          "--policy",
          path.join(root, "policy.json"),
          "--migrations",
          migrations,
          "--online-indexes",
          online,
          "--applied",
          applied,
        ],
        { encoding: "utf8" },
      );
      expect(JSON.parse(stdout).pending).toEqual(["002_middle", "003_last"]);

      for (const [label, appliedPath, content] of [
        ["empty", applied, ""],
        ["duplicate", applied, "001_first\n001_first\n"],
        ["non-prefix", applied, "002_middle\n"],
        ["unreadable", path.join(root, "missing-applied.txt"), null],
      ] as const) {
        if (content !== null) fs.writeFileSync(appliedPath, content);
        expect(
          spawnSync(
            process.execPath,
            [
              path.join(
                process.cwd(),
                "scripts",
                "validate-migration-policy.mjs",
              ),
              "--policy",
              path.join(root, "policy.json"),
              "--migrations",
              migrations,
              "--online-indexes",
              online,
              "--applied",
              appliedPath,
            ],
            { encoding: "utf8" },
          ).status,
          label,
        ).not.toBe(0);
      }
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("sorts CLI migration directories by UTF-8 bytes rather than UTF-16", () => {
    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), "migration-policy-cli-byte-order-"),
    );
    const migrations = path.join(root, "migrations");
    const online = path.join(root, "online");
    const bmpName = "001_\uE000";
    const supplementaryName = "001_\u{10000}";
    const sqlFor = (name: string) => `COMMENT ON TABLE "User" IS '${name}';`;
    fs.mkdirSync(migrations);
    fs.mkdirSync(online);
    for (const name of [supplementaryName, bmpName]) {
      const directory = path.join(migrations, name);
      fs.mkdirSync(directory);
      fs.writeFileSync(path.join(directory, "migration.sql"), sqlFor(name));
    }
    fs.writeFileSync(
      path.join(root, "policy.json"),
      JSON.stringify({
        ...policy,
        approvedOnlineIndexes: [],
        migrations: [
          declaration(bmpName, sqlFor(bmpName)),
          declaration(supplementaryName, sqlFor(supplementaryName)),
        ],
      }),
    );
    const applied = path.join(root, "applied.txt");
    fs.writeFileSync(applied, `${bmpName}\n`);
    try {
      const stdout = execFileSync(
        process.execPath,
        [
          path.join(process.cwd(), "scripts", "validate-migration-policy.mjs"),
          "--policy",
          path.join(root, "policy.json"),
          "--migrations",
          migrations,
          "--online-indexes",
          online,
          "--applied",
          applied,
        ],
        { encoding: "utf8" },
      );
      expect(JSON.parse(stdout).pending).toEqual([supplementaryName]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("requires one exact six-key declaration per byte-sorted candidate migration", () => {
    const migrations = [
      { name: "001_first", sql: 'CREATE TABLE "First" ("id" INTEGER);' },
      { name: "002_second", sql: 'CREATE TABLE "Second" ("id" INTEGER);' },
    ];
    const validDeclarations = migrations.map(({ name, sql }) =>
      declaration(name, sql),
    );
    const validate = (migrationsPolicy: unknown[]) =>
      validateMigrationPolicy({
        policy: {
          ...policy,
          approvedOnlineIndexes: [],
          migrations: migrationsPolicy,
        },
        candidateMigrations: migrations,
        pendingMigrations: [],
        onlineIndexes: [],
      }).errors.join(" ");

    expect(validate(validDeclarations)).toBe("");
    expect(validate(validDeclarations.slice(0, 1))).toMatch(
      /missing.*002_second/i,
    );
    expect(
      validate([...validDeclarations, declaration("003_extra", "SELECT 1")]),
    ).toMatch(/extra.*003_extra/i);
    expect(
      validate([
        validDeclarations[0],
        validDeclarations[0],
        validDeclarations[1],
      ]),
    ).toMatch(/duplicate.*001_first/i);
    expect(
      validate([
        { ...validDeclarations[0], sha256: "0".repeat(64) },
        validDeclarations[1],
      ]),
    ).toMatch(/hash.*001_first/i);
    expect(
      validate([
        { ...validDeclarations[1], extra: true },
        validDeclarations[0],
      ]),
    ).toMatch(/keys|fields|sorted/i);
  });

  it("requires the exact ordinary pending tuple and forbids automatic contract migrations", () => {
    const sql = 'CREATE TABLE "Pending" ("id" INTEGER);';
    const candidateMigrations = [{ name: "001_pending", sql }];
    const errorsFor = (overrides: Record<string, unknown>) =>
      validateMigrationPolicy({
        policy: {
          ...policy,
          approvedOnlineIndexes: [],
          migrations: [declaration("001_pending", sql, overrides)],
        },
        candidateMigrations,
        pendingMigrations: candidateMigrations,
        onlineIndexes: [],
      }).errors.join(" ");

    for (const overrides of [
      { class: "contract" },
      { execution: "manual" },
      { historicalRowWrites: true },
      { oldCodeCompatible: false },
    ]) {
      expect(errorsFor(overrides)).toMatch(
        /pending.*expand.*automatic|contract.*automatic/i,
      );
    }
    expect(errorsFor({ class: "contract", execution: "automatic" })).toMatch(
      /contract.*automatic/i,
    );
  });

  it("requires a validated passing old-code report for pending enum additions", () => {
    const sql = "ALTER TYPE \"Visibility\" ADD VALUE 'shared';";
    const candidateMigrations = [{ name: "001_enum", sql }];
    const binding = {
      upgradeFrom: ["Inkvia-v2098.12.31.1"],
      newVersion: "Inkvia-v2099.01.01.1",
      gitCommit: "a".repeat(40),
      artifactSha256: "b".repeat(64),
    };
    const report = {
      oldVersion: binding.upgradeFrom[0],
      newVersion: binding.newVersion,
      gitCommit: binding.gitCommit,
      artifactSha256: binding.artifactSha256,
      migrationSetSha256: "c".repeat(64),
      sourceDatabaseSha256: "d".repeat(64),
      oldCodeReadOnlyProbePassed: true,
    };
    const validate = (compatibilityReport?: Record<string, unknown>) =>
      validateMigrationPolicy({
        policy: {
          ...policy,
          approvedOnlineIndexes: [],
          migrations: [declaration("001_enum", sql)],
        },
        candidateMigrations,
        pendingMigrations: candidateMigrations,
        onlineIndexes: [],
        compatibilityReport,
        compatibilityBinding: binding,
      }).errors.join(" ");

    expect(validate()).toMatch(/enum.*compatibility report/i);
    expect(validate({ ...report, oldCodeReadOnlyProbePassed: false })).toMatch(
      /enum.*compatibility report/i,
    );
    expect(validate(report)).toBe("");
  });
});
