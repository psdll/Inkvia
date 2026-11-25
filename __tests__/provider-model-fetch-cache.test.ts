import { describe, expect, it } from "vitest";
import {
  applyFetchedModelsIfCurrent,
  canAddCurrentFetchedChatModel,
  canConfirmProviderModelFetch,
  canAddFetchedChatModel,
  canFetchProviderModels,
  canStartProviderModelFetch,
  ensureProviderModelFetchRevisions,
  getAvailableFetchedModels,
  getCurrentAvailableFetchedModels,
  invalidateProviderModelFetchRequest,
  invalidateProviderModelFetchState,
  isCurrentProviderModelFetch,
  replaceProviderModelFetchSnapshot,
  runOwnedProviderModelFetch,
  runProviderModelFetch,
  type ProviderModelFetchModal,
  type ProviderModelFetchRequestUiState,
  type ProviderModelFetchResponse,
  type ProviderModelFetchState,
} from "@/lib/providers/model-fetch-cache";

type FetchTransient = "busy" | { kind: "fetch"; ok: boolean; message: string };

const toFetchTransient = (notice: { ok: boolean; message: string }): FetchTransient => ({
  kind: "fetch",
  ...notice,
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("provider pulled model cache", () => {
  const entry = {
    revision: 3,
    groups: { image: ["image-a"], video: [], chat: ["chat-a", "chat-b", "chat-a"] },
  };

  const createOwnedFetchHarness = () => {
    const key = "openai:fetch-models";
    let nextToken = 0;
    let fetchState: ProviderModelFetchState = {
      revisions: { openai: 0 },
      entries: {},
      chatModelDrafts: {},
    };
    let requestUi: ProviderModelFetchRequestUiState<FetchTransient> = {
      owners: {},
      transient: {},
    };
    const modals: ProviderModelFetchModal[] = [];
    const run = (execute: () => Promise<ProviderModelFetchResponse>) => runOwnedProviderModelFetch({
      key,
      providerId: "openai",
      providerName: "OpenAI",
      providerIds: ["openai"],
      savedProviderFingerprints: { openai: "saved" },
      supportsModelFetch: true,
      getCurrentProviderIds: () => ["openai"],
      getState: () => fetchState,
      replaceState: (next) => { fetchState = next; },
      openModal: (next) => { modals.push(next); },
      getRequestUiState: () => requestUi,
      replaceRequestUiState: (next) => { requestUi = next; },
      nextToken: () => { nextToken += 1; return nextToken; },
      busy: "busy" as const,
      toTransient: toFetchTransient,
      toErrorTransient: (error) => ({
        kind: "fetch" as const,
        ok: false,
        message: String(error instanceof Error ? error.message : error),
      }),
      notStartedMessage: "平台配置已变化，请重新拉取模型",
    }, execute);
    const invalidate = () => {
      fetchState = invalidateProviderModelFetchState(fetchState, "openai");
      requestUi = invalidateProviderModelFetchRequest(requestUi, key, "openai");
    };
    return {
      key,
      run,
      invalidate,
      modals,
      get fetchState() { return fetchState; },
      get requestUi() { return requestUi; },
    };
  };

  it("returns deduplicated unselected models for the current target", () => {
    expect(getAvailableFetchedModels(entry, 3, "chat", ["chat-a"])).toEqual(["chat-b"]);
  });

  it("returns no stale candidates after target changes", () => {
    expect(getAvailableFetchedModels(entry, 4, "chat", [])).toEqual([]);
  });

  it("clears a provider chat draft and fetched entry when its configuration changes", () => {
    expect(invalidateProviderModelFetchState({
      revisions: { openai: 2, apimart: 5 },
      entries: { openai: entry },
      chatModelDrafts: { openai: "chat-b", apimart: "other-chat" },
    }, "openai")).toEqual({
      revisions: { openai: 3, apimart: 5 },
      entries: {},
      chatModelDrafts: { apimart: "other-chat" },
    });
  });

  it("does not invent a revision when invalidating a provider outside the server snapshot", () => {
    expect(invalidateProviderModelFetchState({
      revisions: {},
      entries: { openai: { ...entry, revision: 0 } },
      chatModelDrafts: { openai: "chat-b" },
    }, "openai")).toEqual({
      revisions: {},
      entries: {},
      chatModelDrafts: {},
    });
  });

  it("rejects stale draft additions and in-flight results after a revision changes", () => {
    const invalidated = invalidateProviderModelFetchState({
      revisions: { openai: 2 },
      entries: { openai: entry },
      chatModelDrafts: { openai: "chat-b" },
    }, "openai");

    expect(canAddFetchedChatModel("chat-b", [])).toBe(false);
    expect(canAddFetchedChatModel("chat-b", ["chat-b"])).toBe(true);
    expect(isCurrentProviderModelFetch(invalidated.revisions, "openai", 2)).toBe(false);
    expect(applyFetchedModelsIfCurrent(invalidated, "openai", 2, entry.groups)).toEqual({
      applied: false,
      state: invalidated,
    });
  });

  it("requires custom providers to be saved before models can be fetched", () => {
    expect(canFetchProviderModels(false, true)).toBe(false);
    expect(canFetchProviderModels(true, true)).toBe(true);
    expect(canStartProviderModelFetch("custom", ["custom"], {}, true, { custom: 0 })).toBe(false);
    expect(canStartProviderModelFetch("custom", ["custom"], { custom: "saved" }, true, { custom: 0 })).toBe(true);
  });

  it("never treats a missing revision as the initial revision", () => {
    const state = { revisions: {}, entries: {}, chatModelDrafts: {} };

    expect(isCurrentProviderModelFetch(state.revisions, "openai", 0)).toBe(false);
    expect(applyFetchedModelsIfCurrent(state, "openai", 0, entry.groups)).toEqual({
      applied: false,
      state,
    });
    expect(canConfirmProviderModelFetch(state, ["openai"], "openai", 0)).toBe(false);
    expect(canStartProviderModelFetch("openai", ["openai"], { openai: "saved" }, true, {})).toBe(false);
    expect(isCurrentProviderModelFetch({ openai: 0 }, "openai", 0)).toBe(true);
  });

  it("initializes new snapshot providers at zero and only increments existing revisions", () => {
    const initial = replaceProviderModelFetchSnapshot({
      revisions: {},
      entries: {},
      chatModelDrafts: {},
    }, ["openai"]);
    expect(initial.revisions).toEqual({ openai: 0 });

    const refreshed = replaceProviderModelFetchSnapshot({
      ...initial,
      entries: { openai: { ...entry, revision: 0 } },
      chatModelDrafts: { openai: "chat-b" },
    }, ["openai", "new-provider"]);
    expect(refreshed).toEqual({
      revisions: { openai: 1, "new-provider": 0 },
      entries: {},
      chatModelDrafts: {},
    });

    expect(replaceProviderModelFetchSnapshot(refreshed, ["new-provider"]).revisions).toEqual({
      openai: 2,
      "new-provider": 1,
    });
  });

  it("registers a newly saved provider at zero without invalidating retained providers", () => {
    const state = {
      revisions: { openai: 3 },
      entries: { openai: entry },
      chatModelDrafts: { openai: "chat-b" },
    };
    expect(ensureProviderModelFetchRevisions(state, ["openai", "custom"])).toEqual({
      revisions: { openai: 3, custom: 0 },
      entries: { openai: entry },
      chatModelDrafts: { openai: "chat-b" },
    });
  });

  it("renders no candidates without an explicit provider revision", () => {
    const state = {
      revisions: {},
      entries: { openai: { ...entry, revision: 0 } },
      chatModelDrafts: {},
    };
    expect(getCurrentAvailableFetchedModels(state, "openai", "chat", [])).toEqual([]);
    expect(getCurrentAvailableFetchedModels({ ...state, revisions: { openai: 0 } }, "openai", "chat", [])).toEqual([
      "chat-a",
      "chat-b",
    ]);
  });

  it("keeps a removed provider revision as a tombstone so its request cannot revive", () => {
    const refreshed = replaceProviderModelFetchSnapshot({
      revisions: { removed: 0 },
      entries: {},
      chatModelDrafts: {},
    }, []);

    expect(isCurrentProviderModelFetch(refreshed.revisions, "removed", 0)).toBe(false);
    expect(applyFetchedModelsIfCurrent(refreshed, "removed", 0, entry.groups).applied).toBe(false);
    expect(canConfirmProviderModelFetch(refreshed, [], "removed", 0)).toBe(false);
    expect(canConfirmProviderModelFetch(refreshed, ["removed"], "removed", 0)).toBe(false);
  });

  it("recomputes the current fetched options before accepting a previously rendered draft", () => {
    const invalidated = invalidateProviderModelFetchState({
      revisions: { openai: 2 },
      entries: { openai: entry },
      chatModelDrafts: { openai: "chat-b" },
    }, "openai");

    expect(canAddCurrentFetchedChatModel(invalidated, "openai", [], "chat-b")).toBe(false);
  });

  it("invalidates fetched models when a provider is enabled or disabled", () => {
    const toggled = invalidateProviderModelFetchState({
      revisions: { openai: 3 },
      entries: { openai: entry },
      chatModelDrafts: { openai: "chat-b" },
    }, "openai");

    expect(canAddCurrentFetchedChatModel(toggled, "openai", [], "chat-b")).toBe(false);
    expect(applyFetchedModelsIfCurrent(toggled, "openai", 3, entry.groups).applied).toBe(false);
    expect(canConfirmProviderModelFetch(toggled, ["openai"], "openai", 3)).toBe(false);
  });

  it("orchestrates the production fetch path from revision capture through opening the modal", async () => {
    let state: ProviderModelFetchState = {
      revisions: { custom: 0 },
      entries: {},
      chatModelDrafts: {},
    };
    let modal: ProviderModelFetchModal | null = null;
    let requestCount = 0;
    const execute = async () => {
      requestCount += 1;
      return {
        ok: true,
        total: 2,
        grouped: { image: [], video: [], chat: ["chat-a", "chat-b"] },
      };
    };
    const baseInput = {
      providerId: "custom",
      providerName: "Custom",
      providerIds: ["custom"],
      supportsModelFetch: true,
      getCurrentProviderIds: () => ["custom"],
      getState: () => state,
      replaceState: (next: ProviderModelFetchState) => { state = next; },
      openModal: (next: ProviderModelFetchModal) => { modal = next; },
    };

    expect(await runProviderModelFetch({ ...baseInput, savedProviderFingerprints: {} }, execute)).toMatchObject({
      started: false,
    });
    expect(requestCount).toBe(0);
    const result = await runProviderModelFetch({
      ...baseInput,
      savedProviderFingerprints: { custom: "saved" },
    }, execute);

    expect(result).toMatchObject({ started: true, applied: true, requestRevision: 0 });
    expect(requestCount).toBe(1);
    expect(state.entries).toEqual({
      custom: {
        revision: 0,
        groups: { image: [], video: [], chat: ["chat-a", "chat-b"] },
      },
    });
    expect(modal).toEqual({
      providerId: "custom",
      providerName: "Custom",
      revision: 0,
      fetchedModels: { image: [], video: [], chat: ["chat-a", "chat-b"] },
    });
  });

  it.each(["enabled", "model-list"])(
    "does not apply an old response after a %s change invalidates the revision",
    async () => {
      let state: ProviderModelFetchState = {
        revisions: { openai: 0 },
        entries: {},
        chatModelDrafts: {},
      };
      let modal: ProviderModelFetchModal | null = null;
      let resolveResponse!: (value: {
        ok: true;
        total: number;
        grouped: typeof entry.groups;
      }) => void;
      const response = new Promise<{
        ok: true;
        total: number;
        grouped: typeof entry.groups;
      }>((resolve) => { resolveResponse = resolve; });

      const pending = runProviderModelFetch({
        providerId: "openai",
        providerName: "OpenAI",
        providerIds: ["openai"],
        savedProviderFingerprints: { openai: "saved" },
        supportsModelFetch: true,
        getCurrentProviderIds: () => ["openai"],
        getState: () => state,
        replaceState: (next: ProviderModelFetchState) => { state = next; },
        openModal: (next: ProviderModelFetchModal) => { modal = next; },
      }, () => response);

      state = invalidateProviderModelFetchState(state, "openai");
      resolveResponse({ ok: true, total: 3, grouped: entry.groups });

      expect(await pending).toMatchObject({ started: true, applied: false, reason: "stale" });
      expect(state.entries).toEqual({});
      expect(modal).toBeNull();
      expect(canConfirmProviderModelFetch(state, ["openai"], "openai", 0)).toBe(false);
    },
  );

  it.each([
    ["ok:false", { ok: false, message: "upstream failed" }],
    ["missing grouped", { ok: true, total: 0 }],
  ] satisfies Array<[string, ProviderModelFetchResponse]>)(
    "returns stale for a %s response settled after invalidation",
    async (_label, settledResponse) => {
      let state: ProviderModelFetchState = {
        revisions: { openai: 0 },
        entries: {},
        chatModelDrafts: {},
      };
      let modal: ProviderModelFetchModal | null = null;
      let resolveResponse!: (value: ProviderModelFetchResponse) => void;
      const response = new Promise<ProviderModelFetchResponse>((resolve) => {
        resolveResponse = resolve;
      });
      const pending = runProviderModelFetch({
        providerId: "openai",
        providerName: "OpenAI",
        providerIds: ["openai"],
        savedProviderFingerprints: { openai: "saved" },
        supportsModelFetch: true,
        getCurrentProviderIds: () => ["openai"],
        getState: () => state,
        replaceState: (next) => { state = next; },
        openModal: (next) => { modal = next; },
      }, () => response);

      state = invalidateProviderModelFetchState(state, "openai");
      resolveResponse(settledResponse);

      expect(await pending).toMatchObject({
        started: true,
        applied: false,
        reason: "stale",
        requestRevision: 0,
      });
      expect(state.entries).toEqual({});
      expect(modal).toBeNull();
    },
  );

  it("returns stale instead of exposing a rejected request settled after invalidation", async () => {
    let state: ProviderModelFetchState = {
      revisions: { openai: 0 },
      entries: {},
      chatModelDrafts: {},
    };
    let modal: ProviderModelFetchModal | null = null;
    let rejectResponse!: (reason: Error) => void;
    const response = new Promise<ProviderModelFetchResponse>((_resolve, reject) => {
      rejectResponse = reject;
    });
    const pending = runProviderModelFetch({
      providerId: "openai",
      providerName: "OpenAI",
      providerIds: ["openai"],
      savedProviderFingerprints: { openai: "saved" },
      supportsModelFetch: true,
      getCurrentProviderIds: () => ["openai"],
      getState: () => state,
      replaceState: (next) => { state = next; },
      openModal: (next) => { modal = next; },
    }, () => response);
    const assertion = expect(pending).resolves.toMatchObject({
      started: true,
      applied: false,
      reason: "stale",
      requestRevision: 0,
    });

    state = invalidateProviderModelFetchState(state, "openai");
    rejectResponse(new Error("network failed"));

    await assertion;
    expect(state.entries).toEqual({});
    expect(modal).toBeNull();
  });

  it("keeps a current rejected request visible to the production panel error handler", async () => {
    const state: ProviderModelFetchState = {
      revisions: { openai: 0 },
      entries: {},
      chatModelDrafts: {},
    };

    await expect(runProviderModelFetch({
      providerId: "openai",
      providerName: "OpenAI",
      providerIds: ["openai"],
      savedProviderFingerprints: { openai: "saved" },
      supportsModelFetch: true,
      getCurrentProviderIds: () => ["openai"],
      getState: () => state,
      replaceState: () => undefined,
      openModal: () => undefined,
    }, async () => {
      throw new Error("network failed");
    })).rejects.toThrow("network failed");
  });

  it("keeps request2 failure and ignores request1 success that arrives later at the same revision", async () => {
    const harness = createOwnedFetchHarness();
    const request1 = deferred<ProviderModelFetchResponse>();
    const pending1 = harness.run(() => request1.promise);
    const pending2 = harness.run(async () => { throw new Error("request2 failed"); });

    await pending2;
    expect(harness.requestUi.transient.openai).toEqual({
      kind: "fetch",
      ok: false,
      message: "request2 failed",
    });

    request1.resolve({ ok: true, total: 1, grouped: entry.groups });
    await pending1;

    expect(harness.modals).toHaveLength(0);
    expect(harness.fetchState.entries).toEqual({});
    expect(harness.requestUi.owners).toEqual({});
    expect(harness.requestUi.transient[harness.key]).toEqual(harness.requestUi.transient.openai);
    expect(harness.requestUi.transient.openai).toMatchObject({ ok: false, message: "request2 failed" });
  });

  it.each([
    ["success", { ok: true, total: 1, grouped: entry.groups }],
    ["API error", { ok: false, message: "old API error" }],
    ["missing grouped", { ok: true, total: 0 }],
    ["rejection", null],
  ] satisfies Array<[string, ProviderModelFetchResponse | null]>)(
    "keeps a newer busy owner untouched when the old request settles with %s",
    async (_label, oldOutcome) => {
      const harness = createOwnedFetchHarness();
      const request1 = deferred<ProviderModelFetchResponse>();
      const request2 = deferred<ProviderModelFetchResponse>();
      const pending1 = harness.run(() => request1.promise);
      void harness.run(() => request2.promise);

      if (oldOutcome) request1.resolve(oldOutcome);
      else request1.reject(new Error("old rejected"));
      await pending1;

      expect(harness.modals).toHaveLength(0);
      expect(harness.fetchState.entries).toEqual({});
      expect(harness.requestUi.transient).toEqual({ [harness.key]: "busy" });
      expect(Object.keys(harness.requestUi.owners)).toEqual([harness.key]);
    },
  );

  it("commits cache, modal, and success transient for the current owner", async () => {
    const harness = createOwnedFetchHarness();

    await harness.run(async () => ({ ok: true, total: 3, grouped: entry.groups }));

    expect(harness.fetchState.entries.openai).toEqual({ revision: 0, groups: entry.groups });
    expect(harness.modals).toEqual([{
      providerId: "openai",
      providerName: "OpenAI",
      revision: 0,
      fetchedModels: entry.groups,
    }]);
    expect(harness.requestUi.owners).toEqual({});
    expect(harness.requestUi.transient.openai).toMatchObject({
      kind: "fetch",
      ok: true,
      message: "拉到 3 个模型，请在弹窗中选择",
    });
  });

  it("releases busy immediately on invalidation and keeps the later settlement silent", async () => {
    const harness = createOwnedFetchHarness();
    const response = deferred<ProviderModelFetchResponse>();
    const pending = harness.run(() => response.promise);

    expect(harness.requestUi.transient[harness.key]).toBe("busy");
    harness.invalidate();
    expect(harness.requestUi).toEqual({ owners: {}, transient: {} });

    response.resolve({ ok: true, total: 1, grouped: entry.groups });
    await pending;

    expect(harness.fetchState.entries).toEqual({});
    expect(harness.modals).toHaveLength(0);
    expect(harness.requestUi).toEqual({ owners: {}, transient: {} });
  });

  it.each([
    ["API error", { ok: false, message: "upstream failed" }, "upstream failed"],
    ["missing grouped", { ok: true, total: 0 }, "模型响应缺少分组数据"],
  ] satisfies Array<[string, ProviderModelFetchResponse, string]>)(
    "shows a current %s as an error without cache or modal side effects",
    async (_label, response, expectedMessage) => {
      const harness = createOwnedFetchHarness();

      await harness.run(async () => response);

      expect(harness.fetchState.entries).toEqual({});
      expect(harness.modals).toHaveLength(0);
      expect(harness.requestUi.transient.openai).toEqual({
        kind: "fetch",
        ok: false,
        message: expectedMessage,
      });
    },
  );

  it("shows a current network error without cache or modal side effects", async () => {
    const harness = createOwnedFetchHarness();

    await harness.run(async () => { throw new Error("network failed"); });

    expect(harness.fetchState.entries).toEqual({});
    expect(harness.modals).toHaveLength(0);
    expect(harness.requestUi.transient.openai).toEqual({
      kind: "fetch",
      ok: false,
      message: "network failed",
    });
  });

  it("rejects a response when the provider is removed and refuses to start without a revision", async () => {
    let state: ProviderModelFetchState = {
      revisions: { openai: 0 },
      entries: {},
      chatModelDrafts: {},
    };
    let providerIds = ["openai"];
    let modal: ProviderModelFetchModal | null = null;
    let requestCount = 0;
    let resolveResponse!: (value: {
      ok: true;
      total: number;
      grouped: typeof entry.groups;
    }) => void;
    const response = new Promise<{
      ok: true;
      total: number;
      grouped: typeof entry.groups;
    }>((resolve) => { resolveResponse = resolve; });
    const input = {
      providerId: "openai",
      providerName: "OpenAI",
      providerIds,
      savedProviderFingerprints: { openai: "saved" },
      supportsModelFetch: true,
      getCurrentProviderIds: () => providerIds,
      getState: () => state,
      replaceState: (next: ProviderModelFetchState) => { state = next; },
      openModal: (next: ProviderModelFetchModal) => { modal = next; },
    };
    const pending = runProviderModelFetch(input, () => {
      requestCount += 1;
      return response;
    });

    providerIds = [];
    state = replaceProviderModelFetchSnapshot(state, providerIds);
    resolveResponse({ ok: true, total: 3, grouped: entry.groups });

    expect(await pending).toMatchObject({ started: true, applied: false, reason: "stale" });
    expect(requestCount).toBe(1);
    expect(modal).toBeNull();

    state = { revisions: {}, entries: {}, chatModelDrafts: {} };
    providerIds = ["openai"];
    const missingRevisionResult = await runProviderModelFetch({
      ...input,
      providerIds,
    }, async () => {
      requestCount += 1;
      return { ok: true, total: 3, grouped: entry.groups };
    });

    expect(missingRevisionResult).toMatchObject({ started: false });
    expect(requestCount).toBe(1);
    expect(modal).toBeNull();
  });
});
