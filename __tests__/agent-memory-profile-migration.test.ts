import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const migrationPath = path.join(root, "prisma/migrations/20260830200000_agent_memory_profile/migration.sql");

describe("Agent memory profile expand migration", () => {
  it("adds one profile per user with revision and tombstone fields", () => {
    const schema = fs.readFileSync(path.join(root, "prisma/schema.prisma"), "utf8");
    const model = schema.match(/model AgentMemoryProfile \{([\s\S]*?)\n\}/)?.[1] || "";
    expect(model).toMatch(/userId\s+Int\s+@unique/);
    expect(model).toMatch(/revision\s+Int\s+@default\(0\)/);
    expect(model).toMatch(/deletedAt\s+DateTime\?/);
    expect(model).toMatch(/fileSyncedAt\s+DateTime\?/);
    expect(model).toMatch(/syncError\s+String\?/);
    expect(model).toMatch(/createdAt\s+DateTime\s+@default\(now\(\)\)/);
    expect(model).toMatch(/updatedAt\s+DateTime\s+@updatedAt/);
    expect(schema).toMatch(/agentMemoryProfile\s+AgentMemoryProfile\?/);
  });

  it("is additive and does not rewrite historical business rows", () => {
    const sql = fs.readFileSync(migrationPath, "utf8");
    expect(sql).toMatch(/CREATE TABLE "AgentMemoryProfile"/);
    expect(sql).toMatch(/UNIQUE INDEX IF NOT EXISTS "AgentMemoryProfile_userId_key"/);
    expect(sql).not.toMatch(/^\s*(?:DROP|ALTER\s+TABLE\s+.+\s+RENAME|TRUNCATE|UPDATE|DELETE\s+FROM)\b/im);
  });
});
