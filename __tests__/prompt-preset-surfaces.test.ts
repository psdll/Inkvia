import { existsSync, readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authState = vi.hoisted(() => ({
  current: {
    user: { id: 1, username: "a" } as { id: number; username: string } | null,
    loading: false,
  },
}));

vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => authState.current,
}));

const read = (path: string) => {
  expect(existsSync(path), `${path} must exist`).toBe(true);
  return readFileSync(path, "utf8");
};

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

function jsonResponse(value: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => value,
  } as Response;
}

function preset(id: string, name: string) {
  return {
    id,
    name,
    category: "测试",
    content: `${name} content`,
    source: id.startsWith("builtin:") ? "builtin" as const : "custom" as const,
    revision: 1,
    createdAt: "2026-07-30T00:00:00.000Z",
    updatedAt: "2026-07-30T00:00:00.000Z",
  };
}

class FakeBroadcastChannel {
  static instances: FakeBroadcastChannel[] = [];
  listeners: Array<(event: MessageEvent) => void> = [];
  messages: unknown[] = [];

  constructor(readonly name: string) {
    FakeBroadcastChannel.instances.push(this);
  }

  addEventListener(_type: string, listener: (event: MessageEvent) => void) {
    this.listeners.push(listener);
  }

  postMessage(message: unknown) {
    this.messages.push(message);
  }

  emit(data: unknown) {
    this.listeners.forEach((listener) => listener({ data } as MessageEvent));
  }
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  vi.resetModules();
  authState.current = {
    user: { id: 1, username: "a" },
    loading: false,
  };
  FakeBroadcastChannel.instances = [];
  vi.stubGlobal("BroadcastChannel", FakeBroadcastChannel);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("unified prompt preset user surfaces", () => {
  it("uses one session-authenticated collection for every surface", () => {
    const hook = read("components/presets/use-prompt-presets.ts");
    const trigger = read("components/presets/preset-prompts.tsx");
    const image = read("app/image/image-tool.tsx");
    const video = read("app/video/video-tool.tsx");

    const batch = read(
      "components/batch-workbench/batch-settings-panel.tsx",
    );
    const canvas = read("components/canvas/PromptTemplatePicker.tsx");

    expect(hook).toContain('fetch("/api/prompt-presets"');
    expect(hook).toContain('new BroadcastChannel("prompt-presets")');
    expect(hook).toContain("useAuth()");
    expect(hook).toContain("authLoading");
    expect(trigger).toContain("usePromptPresets()");
    expect(trigger).not.toContain("/api/presets");
    expect(trigger).not.toMatch(/\buserId\b/);
    expect(trigger).not.toMatch(/\bscope\b/);
    expect(image).not.toContain('scope="image"');
    expect(video).not.toContain('scope="video"');

    expect(batch).not.toContain('scope="image_batch"');
    expect(canvas).toContain("usePromptPresets()");
  });

  it("uses single-record writes and replaces a converted builtin locally", () => {
    const hook = read("components/presets/use-prompt-presets.ts");

    expect(hook).toContain('method: "POST"');
    expect(hook).toContain('method: "PATCH"');
    expect(hook).toContain('method: "DELETE"');
    expect(hook).toContain("expectedRevision");
    expect(hook).toMatch(
      /current\.filter\(\s*\(preset\) => preset\.id !== publicId,\s*\)/,
    );
    expect(hook).not.toContain('method: "PUT"');
  });

  it("keeps source out of presentation while exposing equal edit and delete actions", () => {
    const trigger = read("components/presets/preset-prompts.tsx");

    expect(trigger).toContain("filtered.map");
    expect(trigger).toContain("openEdit(p)");
    expect(trigger).toContain("setDeleteTarget(p)");
    expect(trigger).not.toContain("内置");
    expect(trigger).not.toContain("isBuiltinPreset");
  });
});

describe("usePromptPresets user store behavior", () => {
  it("switches users without showing the previous user's cached list", async () => {
    const userB = deferred<Response>();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ presets: [preset("custom:1", "A")] }))
      .mockReturnValueOnce(userB.promise);
    vi.stubGlobal("fetch", fetchMock);

    const { createPromptPresetStore } = await import(
      "@/components/presets/use-prompt-presets"
    );
    const store = createPromptPresetStore();
    store.setUser("1");
    await flush();
    expect(store.getSnapshot().presets.map((item) => item.name)).toEqual(["A"]);

    store.setUser("2");

    expect(store.getSnapshot().presets).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    userB.resolve(jsonResponse({ presets: [preset("custom:2", "B")] }));
    await flush();
    expect(store.getSnapshot().presets.map((item) => item.name)).toEqual(["B"]);
  });

  it("ignores a pending response invalidated by another tab and follows with a fresh GET", async () => {
    const stale = deferred<Response>();
    const fresh = deferred<Response>();
    const fetchMock = vi
      .fn()
      .mockReturnValueOnce(stale.promise)
      .mockReturnValueOnce(fresh.promise);
    vi.stubGlobal("fetch", fetchMock);

    const { createPromptPresetStore } = await import(
      "@/components/presets/use-prompt-presets"
    );
    const store = createPromptPresetStore();
    store.setUser("1");
    const channel = FakeBroadcastChannel.instances[0];
    expect(channel?.name).toBe("prompt-presets");

    channel.emit({ type: "invalidate", userKey: "1" });
    stale.resolve(jsonResponse({ presets: [preset("custom:1", "stale")] }));
    while (fetchMock.mock.calls.length < 2) {
      await new Promise((resolve) => setImmediate(resolve));
    }

    expect(store.getSnapshot().presets).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    fresh.resolve(jsonResponse({ presets: [preset("custom:2", "fresh")] }));
    await flush();
    expect(store.getSnapshot().presets.map((item) => item.name)).toEqual(["fresh"]);
  });

  it("publishes a complete fresh GET after mutation when no trusted baseline exists", async () => {
    const stale = deferred<Response>();
    const full = deferred<Response>();
    const created = preset("custom:3", "created");
    const existing = preset("builtin:4", "existing");
    let getCount = 0;
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") return Promise.resolve(jsonResponse(created));
      getCount += 1;
      return getCount === 1 ? stale.promise : full.promise;
    });
    vi.stubGlobal("fetch", fetchMock);

    const { createPromptPresetStore } = await import(
      "@/components/presets/use-prompt-presets"
    );
    const store = createPromptPresetStore();
    store.setUser("1");
    const mutation = store.createPreset({
      name: created.name,
      category: created.category,
      content: created.content,
    });

    stale.resolve(jsonResponse({ presets: [preset("custom:1", "old")] }));
    await flush();
    full.resolve(jsonResponse({ presets: [created, existing] }));
    await mutation;

    expect(store.getSnapshot().presets.map((item) => item.name)).toEqual([
      "created",
      "existing",
    ]);
    expect(getCount).toBe(2);
  });

  it("does not refresh a captured user after mutation resolves under another active session", async () => {
    const mutationResponse = deferred<Response>();
    let session: "A" | "B" = "A";
    let getCount = 0;
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") return mutationResponse.promise;
      getCount += 1;
      return Promise.resolve(
        jsonResponse({
          presets:
            session === "A"
              ? [preset("custom:10", getCount === 1 ? "A baseline" : "A fresh")]
              : [preset("custom:20", "B baseline")],
        }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const { createPromptPresetStore } = await import(
      "@/components/presets/use-prompt-presets"
    );
    const store = createPromptPresetStore();
    store.setUser("1");
    await flush();
    expect(store.getSnapshot().presets.map((item) => item.name)).toEqual([
      "A baseline",
    ]);

    const mutation = store.createPreset({
      name: "late A",
      category: "测试",
      content: "late A content",
    });
    session = "B";
    store.setUser("2");
    await flush();
    expect(store.getSnapshot().presets.map((item) => item.name)).toEqual([
      "B baseline",
    ]);

    mutationResponse.resolve(jsonResponse(preset("custom:11", "late A")));
    await mutation;
    await flush();
    expect(FakeBroadcastChannel.instances[0]?.messages).toEqual([
      { type: "invalidate", userKey: "1" },
    ]);
    expect(getCount).toBe(2);
    expect(store.getSnapshot().presets.map((item) => item.name)).toEqual([
      "B baseline",
    ]);

    session = "A";
    store.setUser("1");
    await flush();
    expect(getCount).toBe(3);
    expect(store.getSnapshot().presets.map((item) => item.name)).toEqual([
      "A fresh",
    ]);
  });

  it("does not refresh a captured user when a delayed mutation fails after a user switch", async () => {
    const mutationResponse = deferred<Response>();
    let getCount = 0;
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") return mutationResponse.promise;
      getCount += 1;
      return Promise.resolve(
        jsonResponse({
          presets: [preset(`custom:${getCount}`, `user ${getCount}`)],
        }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const { createPromptPresetStore } = await import(
      "@/components/presets/use-prompt-presets"
    );
    const store = createPromptPresetStore();
    store.setUser("1");
    await flush();
    const mutation = store.createPreset({
      name: "will fail",
      category: "测试",
      content: "will fail content",
    });
    store.setUser("2");
    await flush();

    mutationResponse.resolve(jsonResponse({ error: "failed" }, 500));
    await expect(mutation).rejects.toThrow("failed");
    await flush();
    expect(FakeBroadcastChannel.instances[0]?.messages).toEqual([]);
    expect(getCount).toBe(2);
  });

  it("returns a rejected promise from reload while logged out", async () => {
    const { createPromptPresetStore } = await import(
      "@/components/presets/use-prompt-presets"
    );
    const store = createPromptPresetStore();

    await expect(store.reload()).rejects.toThrow("请先登录");
  });

  it("publishes stable snapshots that include loading and error changes", async () => {
    const failed = deferred<Response>();
    vi.stubGlobal("fetch", vi.fn(() => failed.promise));
    const { createPromptPresetStore } = await import(
      "@/components/presets/use-prompt-presets"
    );
    const store = createPromptPresetStore();

    store.setUser("1");
    const loadingSnapshot = store.getSnapshot();
    expect(loadingSnapshot.loading).toBe(true);
    expect(loadingSnapshot.error).toBeNull();
    expect(store.getSnapshot()).toBe(loadingSnapshot);

    failed.resolve(jsonResponse({ error: "load failed" }, 500));
    while (store.getSnapshot().loading) {
      await new Promise((resolve) => setImmediate(resolve));
    }

    const failedSnapshot = store.getSnapshot();
    expect(failedSnapshot).not.toBe(loadingSnapshot);
    expect(failedSnapshot.loading).toBe(false);
    expect(failedSnapshot.error).toBe("load failed");
    expect(store.getSnapshot()).toBe(failedSnapshot);
  });
});
