import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  deleteOssObjects: vi.fn(),
}));

vi.mock("@/lib/oss", () => ({
  deleteOssObjects: mocks.deleteOssObjects,
}));

import { runToolMediaRelayMaintenanceBatch } from "@/lib/tool-media/maintenance";

describe("tool media GC and relay cleanup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.deleteOssObjects.mockResolvedValue({ deleted: 1 });
  });

  it("excludes generation inputs in both GC claim and final purge SQL", () => {
    const gcSource = readFileSync("lib/canvas/media-gc.ts", "utf8");
    const exclusions = gcSource.match(/NOT EXISTS\s*\(\s*SELECT 1 FROM "GenerationInputMedia"/g) || [];
    expect(exclusions).toHaveLength(2);
    expect(gcSource).toMatch(/isToolInputMedia\(asset\.metadata\)[\s\S]*deleteOssObjects\(\[relayKey\]\)/);
  });

  it("uses the same row lock that generation claiming uses to close the GC race", () => {
    const generationInputs = readFileSync("lib/tool-media/generation-inputs.ts", "utf8");
    expect(generationInputs).toMatch(/FROM "MediaAsset"[\s\S]*FOR UPDATE/);
    expect(generationInputs).toMatch(/generationInputMedia\.createMany/);
    expect(generationInputs).toMatch(/retentionUntil:\s*null/);
  });

  it("claims only terminal grace-expired linked relays and clears relay data after OSS deletion", async () => {
    const events: string[] = [];
    const queryRaw = vi.fn()
      .mockImplementationOnce(async () => {
        events.push("claim");
        return [{ id: firstId, objectKey: "uploads/tool-input-relay/first.png" }];
      })
      .mockImplementationOnce(async () => {
        events.push("relock");
        return [{ id: firstId, objectKey: "uploads/tool-input-relay/first.png" }];
      });
    const executeRaw = vi.fn().mockResolvedValue(1);
    mocks.deleteOssObjects.mockImplementationOnce(async () => {
      events.push("delete");
      return { deleted: 1 };
    });
    const client = {
      $transaction: vi.fn(async (callback: (tx: { $queryRaw: typeof queryRaw; $executeRaw: typeof executeRaw }) => unknown) =>
        callback({ $queryRaw: queryRaw, $executeRaw: executeRaw })),
      $executeRaw: executeRaw,
    };

    const result = await runToolMediaRelayMaintenanceBatch(client as never, {
      workerId: "worker-1",
      now: new Date("2026-07-24T13:00:00.000Z"),
      limit: 10,
    });

    const claimSql = queryRaw.mock.calls[0][0].strings.join("?");
    expect(claimSql).toContain('"metadata"->>\'origin\' = \'tool_input\'');
    expect(claimSql).toContain('"status" IN (\'success\', \'failed\')');
    expect(claimSql).toContain("INTERVAL '30 minutes'");
    expect(claimSql).toContain("FOR UPDATE OF asset SKIP LOCKED");
    expect(client.$transaction).toHaveBeenCalledTimes(2);
    expect(events).toEqual(["claim", "relock", "delete"]);
    expect(mocks.deleteOssObjects).toHaveBeenCalledWith(["uploads/tool-input-relay/first.png"]);
    const finishSql = executeRaw.mock.calls.at(-1)?.[0].strings.join("?");
    expect(finishSql).toContain(`"variants" - 'relay'`);
    expect(finishSql).toContain(`"metadata" - 'relay'`);
    expect(finishSql).not.toContain('"originalKey" = NULL');
    expect(result).toEqual({ claimed: 1, purged: 1, failed: 0 });
  });

  it("keeps relay data retryable when OSS deletion fails", async () => {
    mocks.deleteOssObjects.mockRejectedValueOnce(new Error("oss unavailable"));
    const queryRaw = vi.fn()
      .mockResolvedValueOnce([{ id: firstId, objectKey: "uploads/tool-input-relay/first.png" }])
      .mockResolvedValueOnce([{ id: firstId, objectKey: "uploads/tool-input-relay/first.png" }]);
    const executeRaw = vi.fn().mockResolvedValue(1);
    const client = {
      $transaction: vi.fn(async (callback: (tx: { $queryRaw: typeof queryRaw; $executeRaw: typeof executeRaw }) => unknown) =>
        callback({ $queryRaw: queryRaw, $executeRaw: executeRaw })),
      $executeRaw: executeRaw,
    };

    const result = await runToolMediaRelayMaintenanceBatch(client as never, {
      workerId: "worker-1",
      now: new Date("2026-07-24T13:00:00.000Z"),
    });

    expect(result).toEqual({ claimed: 1, purged: 0, failed: 1 });
    expect(executeRaw).toHaveBeenCalledTimes(1);
    expect(executeRaw.mock.calls[0][0].strings.join("?")).not.toContain(`"variants" - 'relay'`);
  });
});

const firstId = "11111111-1111-4111-8111-111111111111";
