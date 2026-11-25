import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  generationUpdateMany: vi.fn(),
  transaction: vi.fn(),
  usage: vi.fn(),
  feed: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    generation: { updateMany: mocks.generationUpdateMany },
    $transaction: mocks.transaction,
  },
}));
vi.mock("@/lib/billing-ledger", () => ({ upsertUsageLedgerForGeneration: mocks.usage }));
vi.mock("@/lib/admin-asset-feed", () => ({ upsertAdminAssetFeedForRows: mocks.feed }));
vi.mock("@/lib/maintenance", () => ({ runGenerationCompletionCreate: <T>(callback: () => T) => callback() }));

import {
  bindGenerationChildToClaim,
  createGenerationClaimLease,
  GenerationClaimLostError,
  heartbeatGenerationClaim,
  releaseGenerationClaim,
  runGenerationClaimWrite,
  terminalizeGenerationClaim,
  withGenerationClaimHeartbeat,
} from "@/lib/generation/claim-lease";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("generation claim lease scheduling", () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    mocks.generationUpdateMany.mockResolvedValue({ count: 1 });
  });

  it("heartbeats every 30 seconds with strictly increasing serialized revisions", async () => {
    vi.useFakeTimers();
    const intervalHeartbeat = deferred<{ count: number }>();
    const operation = deferred<string>();
    mocks.generationUpdateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockReturnValueOnce(intervalHeartbeat.promise)
      .mockResolvedValue({ count: 1 });
    const lease = createGenerationClaimLease(41, "lease-token", new Date(1_000));

    const running = withGenerationClaimHeartbeat(lease, () => operation.promise);
    await flushPromises();
    expect(mocks.generationUpdateMany).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(30_000);
    expect(mocks.generationUpdateMany).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(mocks.generationUpdateMany).toHaveBeenCalledTimes(2);

    intervalHeartbeat.resolve({ count: 1 });
    await lease.tail;
    expect(mocks.generationUpdateMany).toHaveBeenCalledTimes(3);
    const revisions = mocks.generationUpdateMany.mock.calls.map(([input]) => ({
      before: input.where.updatedAt as Date,
      after: input.data.updatedAt as Date,
    }));
    expect(revisions.every(({ before, after }) => after.getTime() > before.getTime())).toBe(true);
    expect(revisions[1].before.getTime()).toBe(revisions[0].after.getTime());
    expect(revisions[2].before.getTime()).toBe(revisions[1].after.getTime());

    operation.resolve("done");
    await expect(running).resolves.toBe("done");
  });

  it.each([
    ["CAS miss", async () => ({ count: 0 })],
    ["database error", async () => { throw new Error("heartbeat database failure"); }],
  ])("marks the lease lost on %s and prevents later writes", async (_label, heartbeatResult) => {
    mocks.generationUpdateMany.mockImplementationOnce(heartbeatResult);
    const lease = createGenerationClaimLease(41, "lease-token", new Date(1_000));

    await expect(heartbeatGenerationClaim(lease)).rejects.toBeInstanceOf(Error);
    await expect(releaseGenerationClaim(lease, { status: "running" })).rejects.toBeInstanceOf(Error);
    expect(lease.lostError).toBeInstanceOf(Error);
    expect(mocks.generationUpdateMany).toHaveBeenCalledTimes(1);
  });

  it("waits for an in-flight heartbeat and serializes the following terminal write", async () => {
    vi.useFakeTimers();
    const intervalHeartbeat = deferred<{ count: number }>();
    const operation = deferred<string>();
    mocks.generationUpdateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockReturnValueOnce(intervalHeartbeat.promise)
      .mockResolvedValueOnce({ count: 1 });
    const lease = createGenerationClaimLease(41, "lease-token", new Date(1_000));
    let stopped = false;

    const running = withGenerationClaimHeartbeat(lease, () => operation.promise).then((value) => {
      stopped = true;
      return value;
    });
    await flushPromises();
    await vi.advanceTimersByTimeAsync(30_000);
    operation.resolve("done");
    await flushPromises();
    expect(stopped).toBe(false);

    const terminal = releaseGenerationClaim(lease, { status: "running" });
    expect(mocks.generationUpdateMany).toHaveBeenCalledTimes(2);
    intervalHeartbeat.resolve({ count: 1 });
    await expect(terminal).resolves.toBe(true);
    await expect(running).resolves.toBe("done");
    expect(mocks.generationUpdateMany).toHaveBeenCalledTimes(3);
    const heartbeatNext = mocks.generationUpdateMany.mock.calls[1][0].data.updatedAt as Date;
    const terminalRevision = mocks.generationUpdateMany.mock.calls[2][0].where.updatedAt as Date;
    expect(terminalRevision.getTime()).toBe(heartbeatNext.getTime());
  });

  it("serializes arbitrary lease writers through the same mutex", async () => {
    const first = deferred<string>();
    const events: string[] = [];
    const lease = createGenerationClaimLease(41, "lease-token", new Date(1_000));
    const one = runGenerationClaimWrite(lease, async () => {
      events.push("first-start");
      const value = await first.promise;
      events.push("first-end");
      return value;
    });
    const two = runGenerationClaimWrite(lease, async () => {
      events.push("second");
      return "two";
    });
    await flushPromises();
    expect(events).toEqual(["first-start"]);
    first.resolve("one");
    await expect(Promise.all([one, two])).resolves.toEqual(["one", "two"]);
    expect(events).toEqual(["first-start", "first-end", "second"]);
  });

  it("commits the terminal generation even when billing synchronization fails", async () => {
    mocks.transaction.mockImplementation(async (callback: (tx: any) => Promise<any>) =>
      callback({ generation: { updateMany: mocks.generationUpdateMany } }));
    mocks.usage.mockRejectedValueOnce(new Error("usage ledger unavailable"));
    mocks.feed.mockResolvedValueOnce(undefined);
    const revision = new Date(1_000);
    const lease = createGenerationClaimLease(41, "lease-token", revision);

    await expect(terminalizeGenerationClaim(
      lease,
      { status: "success", localPath: "/uploads/result.png" },
      { id: 41, status: "success", localPath: "/uploads/result.png" },
    )).resolves.toBe(true);

    expect(mocks.generationUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: "success",
        localPath: "/uploads/result.png",
      }),
    }));
    expect(mocks.usage).toHaveBeenCalledOnce();
    expect(mocks.feed).toHaveBeenCalledOnce();
  });
});

describe("generation child claim transaction", () => {
  type Child = Record<string, any> & { id: number };
  type State = {
    parent: { id: number; status: string; localPath: null; templateData: string; updatedAt: Date };
    children: Child[];
    ledger: Set<number>;
    feed: Set<number>;
  };
  let state: State;
  let createCount: number;
  let failUsage: boolean;
  let cancelDuringCreate: boolean;
  let events: string[];

  const token = "claim-token";
  const childWhere = { type: "image_edit", externalTaskId: "task-41", localPath: "/uploads/two.png" };
  const childData = {
    userId: "7",
    authUserId: 7,
    type: "image_edit",
    source: "tool",
    prompt: "two",
    templateData: "{}",
    model: "model",
    status: "success",
    localPath: "/uploads/two.png",
    externalProvider: "kie",
    externalTaskId: "task-41",
    errorMsg: null,
    createdAt: new Date(),
    finishedAt: new Date(),
  };

  function cloneState(source: State): State {
    return {
      parent: { ...source.parent, updatedAt: new Date(source.parent.updatedAt) },
      children: source.children.map((child) => ({ ...child })),
      ledger: new Set(source.ledger),
      feed: new Set(source.feed),
    };
  }

  function matchesOwner(where: Record<string, any>, draft: State) {
    return where.id === draft.parent.id
      && where.status === draft.parent.status
      && where.localPath === draft.parent.localPath
      && where.updatedAt?.getTime() === draft.parent.updatedAt.getTime()
      && draft.parent.templateData.includes(String(where.templateData?.contains || where.templateData || ""));
  }

  function installTransactionMock() {
    mocks.transaction.mockImplementation(async (callback: (tx: any) => Promise<any>) => {
      const draft = cloneState(state);
      let concurrentCancelled = false;
      const tx = {
        __draft: draft,
        generation: {
          updateMany: async ({ where, data }: { where: Record<string, any>; data: Record<string, any> }) => {
            events.push(data.templateData ? "metadata" : "touch");
            if (!matchesOwner(where, draft)) return { count: 0 };
            if (data.templateData) draft.parent.templateData = data.templateData;
            if (data.updatedAt) draft.parent.updatedAt = data.updatedAt;
            return { count: 1 };
          },
          findUnique: async () => ({ templateData: draft.parent.templateData }),
          findFirst: async ({ where }: { where: Record<string, any> }) => {
            events.push("find");
            return draft.children.find((child) => child.type === where.type
              && child.externalTaskId === where.externalTaskId
              && child.localPath === where.localPath) || null;
          },
          create: async ({ data }: { data: Record<string, any> }) => {
            events.push("create");
            createCount += 1;
            const child = { ...data, id: 84, createdAt: data.createdAt || new Date(), updatedAt: new Date() } as Child;
            draft.children.push(child);
            if (cancelDuringCreate) {
              concurrentCancelled = true;
              draft.parent.status = "cancelled";
            }
            return child;
          },
        },
      };
      try {
        const result = await callback(tx);
        state = draft;
        return result;
      } catch (error) {
        if (concurrentCancelled) state.parent.status = "cancelled";
        throw error;
      }
    });
    mocks.usage.mockImplementation(async (row: Child, tx?: { __draft: State }) => {
      events.push("usage");
      if (failUsage) throw new Error("usage failed");
      (tx?.__draft || state).ledger.add(row.id);
    });
    mocks.feed.mockImplementation(async (rows: Child[], tx?: { __draft: State }) => {
      events.push("feed");
      (tx?.__draft || state).feed.add(rows[0].id);
    });
  }

  function bind(lease = createGenerationClaimLease(41, token, state.parent.updatedAt)) {
    return bindGenerationChildToClaim(lease, {
      childWhere,
      childData,
      buildParentTemplateData: (templateData, child) => JSON.stringify({
        ...JSON.parse(templateData || "{}"),
        savedOutputs: [{ outputIndex: 1, localPath: child.localPath, generationId: child.id }],
      }),
    });
  }

  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    state = {
      parent: {
        id: 41,
        status: "processing",
        localPath: null,
        templateData: JSON.stringify({ finalize: { claimToken: token } }),
        updatedAt: new Date(1_000),
      },
      children: [],
      ledger: new Set(),
      feed: new Set(),
    };
    createCount = 0;
    failUsage = false;
    cancelDuringCreate = false;
    events = [];
    installTransactionMock();
  });

  it("rolls back child, metadata, ledger, and feed when ownership is lost during create", async () => {
    cancelDuringCreate = true;

    await expect(bind()).rejects.toBeInstanceOf(GenerationClaimLostError);

    expect(state.parent.status).toBe("cancelled");
    expect(state.parent.templateData).not.toContain("generationId");
    expect(state.children).toHaveLength(0);
    expect(state.ledger.size).toBe(0);
    expect(state.feed.size).toBe(0);
  });

  it("rejects a stale owner before child lookup or creation", async () => {
    const staleLease = createGenerationClaimLease(41, token, state.parent.updatedAt);
    state.parent.status = "cancelled";

    await expect(bind(staleLease)).rejects.toBeInstanceOf(GenerationClaimLostError);

    expect(events).toEqual(["touch"]);
    expect(state.children).toHaveLength(0);
    expect(state.ledger.size).toBe(0);
    expect(state.feed.size).toBe(0);
  });

  it("allows only one stale owner to create and reuses the same child on retry", async () => {
    const originalRevision = state.parent.updatedAt;
    const firstLease = createGenerationClaimLease(41, token, originalRevision);
    const staleLease = createGenerationClaimLease(41, token, originalRevision);

    await expect(bind(firstLease)).resolves.toMatchObject({ created: true, child: { id: 84 } });
    await expect(bind(staleLease)).rejects.toBeInstanceOf(GenerationClaimLostError);
    const retryLease = createGenerationClaimLease(41, token, state.parent.updatedAt);
    await expect(bind(retryLease)).resolves.toMatchObject({ created: false, child: { id: 84 } });

    expect(createCount).toBe(1);
    expect(state.children).toHaveLength(1);
    expect(state.parent.templateData).toContain('"generationId":84');
    expect(state.ledger).toEqual(new Set([84]));
    expect(state.feed).toEqual(new Set([84]));
  });

  it("keeps the child and parent metadata when a derived projection fails", async () => {
    failUsage = true;

    await expect(bind()).resolves.toMatchObject({ created: true, child: { id: 84 } });
    await flushPromises();

    expect(state.parent.status).toBe("processing");
    expect(state.parent.templateData).toContain('"generationId":84');
    expect(state.children).toHaveLength(1);
    expect(state.ledger.size).toBe(0);
    expect(state.feed).toEqual(new Set([84]));
    expect(events).toEqual(["touch", "find", "create", "metadata", "usage", "feed"]);
  });
});
