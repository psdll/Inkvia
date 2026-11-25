import fs from "node:fs";
import { describe, expect, it } from "vitest";

describe("admin Agent deletion race boundary", () => {
  it("locks the conversation, cancels runs, and deletes dependencies before the conversation", () => {
    const source = fs.readFileSync("lib/admin/legacy-agent-data/admin-delete-service.ts", "utf8");
    expect(source).toContain("pg_advisory_xact_lock");
    expect(source).toContain("cancelRequestedAt");
    const link = source.indexOf("agentGenerationLink.deleteMany");
    const event = source.indexOf("agentEvent.deleteMany");
    const message = source.indexOf("agentMessage.deleteMany");
    const run = source.indexOf("agentRun.deleteMany");
    const conversation = source.indexOf("agentConversation.deleteMany");
    expect(link).toBeGreaterThan(0);
    expect(link).toBeLessThan(event);
    expect(event).toBeLessThan(message);
    expect(message).toBeLessThan(run);
    expect(run).toBeLessThan(conversation);
  });
});
