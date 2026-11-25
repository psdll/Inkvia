import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const schema = fs.readFileSync(path.join(process.cwd(), "prisma", "schema.prisma"), "utf8");
const migration = path.join(process.cwd(), "prisma", "migrations", "20260720220000_canvas_run_step_queue", "migration.sql");

describe("canvas run step queue schema", () => {
  it("pins requests, leases, retries and output slots", () => {
    expect(schema).toMatch(/model CanvasRunStep \{/);
    expect(schema).toMatch(/requestKey\s+String\s+@unique @db\.Uuid/);
    expect(schema).toMatch(/leaseUntil\s+DateTime\?/);
    expect(schema).toMatch(/nextRetryAt\s+DateTime/);
    expect(schema).toMatch(/model CanvasRunOutput \{/);
    expect(schema).toMatch(/@@unique\(\[runStepId, outputSlot\]\)/);
  });

  it("uses additive SQL with queue and lease indexes", () => {
    const sql = fs.readFileSync(migration, "utf8");
    expect(sql).toContain('CREATE TABLE "CanvasRunStep"');
    expect(sql).toContain('CREATE TABLE "CanvasRunOutput"');
    expect(sql).toContain('"CanvasRunStep_status_nextRetryAt_priority_createdAt_idx"');
    expect(sql).not.toMatch(/DROP\s+(?:TABLE|COLUMN)/i);
  });
});
