import fs from "node:fs";
import { describe, expect, it } from "vitest";

import {
  parseAgentEventArchiveRows,
  parseAgentGenerationLinkArchiveRows,
  remapAgentTransferRows,
} from "@/lib/admin/legacy-agent-data/transfer";

describe("Agent V2 account transfer", () => {
  it("validates BigInt archive ids and remaps every Agent foreign key after collisions", () => {
    const events = parseAgentEventArchiveRows([{
      id: "9223372036854775806",
      runId: 1,
      conversationId: 2,
      sequence: 1,
      type: "plan_created",
      payload: { schemaVersion: 1 },
      createdAt: "2026-08-30T12:00:00.000Z",
    }]);
    const links = parseAgentGenerationLinkArchiveRows([{
      id: "9223372036854775805",
      runId: 1,
      conversationId: 2,
      messageId: 3,
      generationId: 4,
      taskType: "image",
      stepKey: "cover",
      requestKey: "1ff71fe7-30e8-5e99-9eb4-6ad0403e9a12",
      userDeletedAt: null,
      purgeAfter: null,
      createdAt: "2026-08-30T12:00:01.000Z",
    }]);
    const result = remapAgentTransferRows({
      events,
      links,
      conversationIdMap: new Map([[2, 202]]),
      runIdMap: new Map([[1, 101]]),
      messageIdMap: new Map([[3, 303]]),
      generationIdMap: new Map([[4, 404]]),
      ownedGenerationIds: new Set([404]),
    });

    expect(result.events).toEqual([expect.objectContaining({ runId: 101, conversationId: 202 })]);
    expect(result.links).toEqual([expect.objectContaining({
      runId: 101,
      conversationId: 202,
      messageId: 303,
      generationId: 404,
    })]);
    expect(result.events[0]).not.toHaveProperty("id");
    expect(result.links[0]).not.toHaveProperty("id");
  });

  it("drops Generation links when the imported generation is absent or not owned", () => {
    const links = parseAgentGenerationLinkArchiveRows([{
      id: "7",
      runId: 1,
      conversationId: 2,
      messageId: null,
      generationId: 4,
      taskType: "video",
      stepKey: "video",
      requestKey: "1ff71fe7-30e8-5e99-9eb4-6ad0403e9a12",
      userDeletedAt: null,
      purgeAfter: null,
      createdAt: "2026-08-30T12:00:01.000Z",
    }]);
    const result = remapAgentTransferRows({
      events: [],
      links,
      conversationIdMap: new Map([[2, 202]]),
      runIdMap: new Map([[1, 101]]),
      messageIdMap: new Map(),
      generationIdMap: new Map([[4, 404]]),
      ownedGenerationIds: new Set(),
    });
    expect(result.links).toEqual([]);
    expect(result.skippedLinks).toBe(1);
  });

  it("includes events and generation links in both export and import inventories", () => {
    const exporter = fs.readFileSync("lib/admin/user-export-builder.ts", "utf8");
    const importer = fs.readFileSync("lib/admin/user-import-runner.ts", "utf8");
    for (const name of ["agent_events.json", "agent_generation_links.json"]) {
      expect(exporter).toContain(name);
      expect(importer).toContain(name);
    }
    expect(importer.indexOf('"agentRun"')).toBeLessThan(importer.indexOf('"agentMessage"'));
  });
});
