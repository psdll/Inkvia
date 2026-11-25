import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const payload = { models: [{ id: "nano-banana-pro", label: "Nano Banana" }] };
const response = (data = payload) => new Response(JSON.stringify(data));

beforeEach(() => { vi.resetModules(); vi.useFakeTimers(); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("shared image model catalog", () => {
  it("shares one request between prewarming, Studio and Batch, then expires", async () => {
    const fetcher = vi.fn().mockResolvedValue(response());
    vi.stubGlobal("fetch", fetcher);
    const { loadImageModelCatalog } = await import("@/lib/client/image-model-catalog");
    const results = await Promise.all([loadImageModelCatalog(), loadImageModelCatalog()]);
    expect(results).toEqual([payload, payload]);
    expect(await loadImageModelCatalog()).toEqual(payload);
    expect(fetcher).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(30_001);
    fetcher.mockResolvedValue(response());
    await loadImageModelCatalog();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("revalidates a changed catalog and does not let an older request overwrite it", async () => {
    let resolveOld!: (value: Response) => void;
    const fetcher = vi.fn().mockImplementationOnce(() => new Promise<Response>(resolve => { resolveOld = resolve; }))
      .mockResolvedValue(response({ models: [] }));
    vi.stubGlobal("fetch", fetcher);
    const { loadImageModelCatalog } = await import("@/lib/client/image-model-catalog");
    const old = loadImageModelCatalog();
    const changed = loadImageModelCatalog({ refresh: true });
    const sibling = loadImageModelCatalog({ refresh: true });
    expect(await changed).toEqual({ models: [] });
    expect(await sibling).toEqual({ models: [] });
    resolveOld(response());
    await old;
    expect(await loadImageModelCatalog()).toEqual({ models: [] });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("does not cache failed requests, including invalid model responses", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response("{}", { status: 503 }))
      .mockResolvedValueOnce(new Response("{}"))
      .mockResolvedValueOnce(response());
    vi.stubGlobal("fetch", fetcher);
    const { loadImageModelCatalog } = await import("@/lib/client/image-model-catalog");
    await expect(loadImageModelCatalog()).rejects.toThrow();
    await expect(loadImageModelCatalog()).rejects.toThrow();
    expect(await loadImageModelCatalog()).toEqual(payload);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
});
