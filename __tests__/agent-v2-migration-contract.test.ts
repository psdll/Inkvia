import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migrationName = "20260830190000_agent_v2_runtime";
const schema = readFileSync(resolve("prisma/schema.prisma"), "utf8");
const migrationPath = resolve("prisma/migrations", migrationName, "migration.sql");
const migration = existsSync(migrationPath) ? readFileSync(migrationPath, "utf8") : "";
const policy = JSON.parse(readFileSync(resolve("config/deploy/migration-policy.json"), "utf8"));

function modelBody(name: string) {
  const match = schema.match(new RegExp(`model\\s+${name}\\s*\\{([\\s\\S]*?)\\n\\}`, "m"));
  expect(match, `missing Prisma model ${name}`).not.toBeNull();
  return match?.[1] || "";
}

describe("Agent V2 expand-only migration", () => {
  it("adds only backward-compatible fields to existing Agent models", () => {
    const conversation = modelBody("AgentConversation");
    for (const field of ["deletedAt", "purgeAfter", "deletedBy", "lastMessageAt", "version"]) {
      expect(conversation, `AgentConversation.${field}`).toMatch(new RegExp(`\\b${field}\\b`));
    }

    const message = modelBody("AgentMessage");
    for (const field of ["kind", "runId", "sequence", "status"]) {
      expect(message, `AgentMessage.${field}`).toMatch(new RegExp(`\\b${field}\\b`));
    }

    const run = modelBody("AgentRun");
    for (const field of [
      "requestKey",
      "routeSnapshot",
      "brief",
      "plan",
      "currentStage",
      "waitingReason",
      "attempt",
      "availableAt",
      "leaseOwner",
      "leaseUntil",
      "startedAt",
      "finishedAt",
      "errorCode",
      "updatedAt",
      "cancelRequestedAt",
    ]) {
      expect(run, `AgentRun.${field}`).toMatch(new RegExp(`\\b${field}\\b`));
    }
  });

  it("adds durable events and generation links with idempotency constraints", () => {
    const event = modelBody("AgentEvent");
    expect(event).toContain("@@unique([runId, sequence])");
    expect(event).toContain("@@index([conversationId, id])");

    const link = modelBody("AgentGenerationLink");
    expect(link).toContain("requestKey");
    expect(link).toContain("@unique");
    expect(link).toContain("@@unique([runId, stepKey])");
    expect(link).toContain("@@index([generationId])");
  });

  it("uses expand-only SQL without historical row writes", () => {
    expect(migration).not.toBe("");
    expect(migration).toMatch(/ADD COLUMN IF NOT EXISTS/i);
    expect(migration).toMatch(/CREATE TABLE "AgentEvent"/i);
    expect(migration).toMatch(/CREATE (?:UNIQUE )?INDEX IF NOT EXISTS/i);
    expect(migration).not.toMatch(/^\s*(?:DROP|RENAME|UPDATE|DELETE|TRUNCATE)\b/im);
  });

  it("registers the migration as an automatic compatible expansion", () => {
    const entry = policy.migrations.find((item: { name?: string }) => item.name === migrationName);
    expect(entry).toMatchObject({
      name: migrationName,
      class: "expand",
      execution: "automatic",
      historicalRowWrites: false,
      oldCodeCompatible: true,
    });
    expect(entry?.sha256).toMatch(/^[a-f0-9]{64}$/);
  });
});
