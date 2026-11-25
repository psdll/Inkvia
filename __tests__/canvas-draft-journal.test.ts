import { describe, expect, it } from "vitest";
import { createEmptyCanvasDocumentV2, type CanvasDocumentV2 } from "@/lib/canvas/document";
import {
  CanvasDraftJournalError,
  createCanvasDraftJournal,
  draftScopeKey,
  type CanvasDraftCommand,
  type CanvasDraftDriver,
  type CanvasDraftScope,
} from "@/lib/canvas/draft-store";

class MemoryDraftDriver implements CanvasDraftDriver {
  readonly records = new Map<string, CanvasDraftCommand>();
  beforePut: (() => Promise<void>) | null = null;

  async list(scope: CanvasDraftScope) {
    return [...this.records.values()]
      .filter((record) => record.scopeKey === draftScopeKey(scope))
      .sort((left, right) => left.clientSequence - right.clientSequence);
  }

  async put(command: CanvasDraftCommand) {
    const beforePut = this.beforePut;
    this.beforePut = null;
    await beforePut?.();
    this.records.set(command.recordKey, structuredClone(command));
  }

  async delete(recordKey: string) {
    this.records.delete(recordKey);
  }
}

const scope: CanvasDraftScope = { authUserId: 7, canvasId: 11, tabId: "tab-a" };

function command(sequence: number, text: string): Omit<CanvasDraftCommand, "recordKey" | "scopeKey" | "status"> {
  return {
    protocolVersion: 1,
    clientMutationId: `mutation-${sequence}`,
    clientSequence: sequence,
    baseRevision: String(sequence),
    createdAt: sequence,
    operations: [{
      opId: `op-${sequence}`,
      kind: "node.patch",
      nodeId: "prompt",
      patch: { data: { text } },
    }],
    inverseOperations: [{
      opId: `inverse-${sequence}`,
      kind: "node.patch",
      nodeId: "prompt",
      patch: { data: { text: "before" } },
    }],
  };
}

function baseDocument(): CanvasDocumentV2 {
  return {
    ...createEmptyCanvasDocumentV2(),
    nodes: [{ id: "prompt", type: "prompt", position: { x: 0, y: 0 }, data: { kind: "prompt", text: "before" } }],
  };
}

describe("canvas IndexedDB draft journal", () => {
  it("persists a command before the sender is invoked", async () => {
    const driver = new MemoryDraftDriver();
    let releasePut!: () => void;
    let notifyPutStarted!: () => void;
    const putStarted = new Promise<void>((resolve) => { notifyPutStarted = resolve; });
    driver.beforePut = () => new Promise<void>((resolve) => {
      releasePut = resolve;
      notifyPutStarted();
    });
    const journal = createCanvasDraftJournal({ driver, scope });
    const calls: string[] = [];

    const pending = journal.submit(command(1, "after"), async (item) => {
      calls.push(item.clientMutationId);
      return { revision: "2" };
    });
    await putStarted;
    expect(calls).toEqual([]);

    releasePut();
    await pending;
    expect(calls).toEqual(["mutation-1"]);
    expect(await driver.list(scope)).toEqual([]);
  });

  it("returns a failed send to pending and retries it on flush", async () => {
    const driver = new MemoryDraftDriver();
    const journal = createCanvasDraftJournal({ driver, scope });

    await expect(journal.submit(command(1, "after"), async () => {
      throw new Error("offline");
    })).rejects.toThrow("offline");
    expect((await driver.list(scope))[0]?.status).toBe("pending");

    const sent: string[] = [];
    await journal.flush(async (item) => {
      sent.push(item.clientMutationId);
      return { revision: "2" };
    });
    expect(sent).toEqual(["mutation-1"]);
    expect(await driver.list(scope)).toEqual([]);
  });

  it("replays pending and interrupted sending commands in sequence order", async () => {
    const driver = new MemoryDraftDriver();
    const journal = createCanvasDraftJournal({ driver, scope });
    await journal.append(command(2, "second"));
    await journal.append(command(1, "first"));
    await journal.markSending("mutation-1");

    const recovered = await journal.recover(baseDocument());

    expect(recovered.nodes[0]?.data).toEqual({ kind: "prompt", text: "second" });
  });

  it("isolates records by user, canvas, and tab", async () => {
    const driver = new MemoryDraftDriver();
    const first = createCanvasDraftJournal({ driver, scope });
    const second = createCanvasDraftJournal({ driver, scope: { ...scope, tabId: "tab-b" } });
    await first.append(command(1, "first"));
    await second.append(command(1, "second"));

    expect((await first.pending()).map((item) => item.operations[0])).toEqual([
      expect.objectContaining({ patch: { data: { text: "first" } } }),
    ]);
    expect((await second.pending()).map((item) => item.operations[0])).toEqual([
      expect.objectContaining({ patch: { data: { text: "second" } } }),
    ]);
  });

  it("rejects bounded-queue overflow without deleting existing commands", async () => {
    const driver = new MemoryDraftDriver();
    const journal = createCanvasDraftJournal({ driver, scope, maxCommands: 1, maxBytes: 1024 * 1024 });
    await journal.append(command(1, "first"));

    await expect(journal.append(command(2, "second"))).rejects.toEqual(
      expect.objectContaining<Partial<CanvasDraftJournalError>>({ code: "DRAFT_COMMAND_LIMIT" }),
    );
    expect(await journal.pending()).toHaveLength(1);
  });

  it("deduplicates the same mutation id but rejects reused ids with different payloads", async () => {
    const driver = new MemoryDraftDriver();
    const journal = createCanvasDraftJournal({ driver, scope });
    await journal.append(command(1, "first"));
    await journal.append(command(1, "first"));

    await expect(journal.append({ ...command(2, "different"), clientMutationId: "mutation-1" })).rejects.toEqual(
      expect.objectContaining<Partial<CanvasDraftJournalError>>({ code: "DRAFT_MUTATION_ID_REUSED" }),
    );
    expect(await journal.pending()).toHaveLength(1);
  });
});
