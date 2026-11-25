import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchJsonOnce } from "@/lib/client/inflight-json";

describe("fetchJsonOnce", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shares concurrent GET requests and releases them after completion", async () => {
    let resolveResponse!: (value: { ok: boolean; json: () => Promise<unknown> }) => void;
    const response = new Promise<{ ok: boolean; json: () => Promise<unknown> }>((resolve) => {
      resolveResponse = resolve;
    });
    const fetchMock = vi.fn(() => response);
    vi.stubGlobal("fetch", fetchMock);

    const first = fetchJsonOnce<{ value: number }>("/api/example");
    const second = fetchJsonOnce<{ value: number }>("/api/example");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    resolveResponse({ ok: true, json: async () => ({ value: 1 }) });
    await expect(Promise.all([first, second])).resolves.toEqual([
      { ok: true, json: { value: 1 } },
      { ok: true, json: { value: 1 } },
    ]);

    await fetchJsonOnce("/api/example");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("keeps requests from different user scopes separate", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
    vi.stubGlobal("fetch", fetchMock);

    await Promise.all([
      fetchJsonOnce("/api/account", "user-1"),
      fetchJsonOnce("/api/account", "user-2"),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not coalesce production requests", async () => {
    const environment = process.env as Record<string, string | undefined>;
    const previousNodeEnv = environment.NODE_ENV;
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
    vi.stubGlobal("fetch", fetchMock);
    environment.NODE_ENV = "production";

    try {
      await Promise.all([
        fetchJsonOnce("/api/account", "user-1"),
        fetchJsonOnce("/api/account", "user-1"),
      ]);
    } finally {
      if (previousNodeEnv === undefined) delete environment.NODE_ENV;
      else environment.NODE_ENV = previousNodeEnv;
    }

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
