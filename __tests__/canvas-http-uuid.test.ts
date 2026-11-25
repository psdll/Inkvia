import { webcrypto } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { validate, version } from "uuid";
import { createBrowserUuid } from "@/lib/browser/random-uuid";
import { createCanvasTaskOutputs } from "@/lib/canvas/image-task";
import { createEmptyCanvasDocumentV2 } from "@/lib/canvas/document";
import { createCanvasDraftJournal, type CanvasDraftCommand } from "@/lib/canvas/draft-store";
import { submitCanvasDocumentChange } from "@/lib/canvas/mutation-client";

afterEach(() => vi.unstubAllGlobals());

function useHttpCrypto() {
  const getRandomValues = vi.fn(webcrypto.getRandomValues.bind(webcrypto));
  vi.stubGlobal("crypto", { getRandomValues });
  return getRandomValues;
}

describe("canvas UUIDs on plain HTTP", () => {
  it("uses secure random bytes to create distinct valid v4 UUIDs without randomUUID", () => {
    const random = useHttpCrypto();
    const ids = Array.from({ length: 100 }, createBrowserUuid);
    expect(ids.every(id => validate(id) && version(id) === 4)).toBe(true);
    expect(new Set(ids).size).toBe(100);
    expect(random).toHaveBeenCalledTimes(100);
  });

  it("keeps the native secure-context implementation when available", () => {
    const randomUUID = vi.fn(() => "123e4567-e89b-42d3-a456-426614174000");
    vi.stubGlobal("crypto", { randomUUID });
    expect(createBrowserUuid()).toBe("123e4567-e89b-42d3-a456-426614174000");
    expect(randomUUID).toHaveBeenCalledOnce();
  });

  it("assigns distinct valid generation request keys to image outputs on HTTP", () => {
    useHttpCrypto();
    let index = 0;
    const outputs = createCanvasTaskOutputs(8, () => `output-${++index}`);
    expect(outputs.every(output => validate(output.requestKey!))).toBe(true);
    expect(new Set(outputs.map(output => output.requestKey)).size).toBe(8);
  });

  it("journals and submits a canvas edit on HTTP without an injected mutation ID", async () => {
    useHttpCrypto();
    const records = new Map<string, CanvasDraftCommand>();
    const put = vi.fn(async (command: CanvasDraftCommand) => { records.set(command.recordKey, command); });
    const remove = vi.fn(async (key: string) => { records.delete(key); });
    const journal = createCanvasDraftJournal({
      driver: { list: async () => [...records.values()], put, delete: remove },
      scope: { authUserId: 1, canvasId: 2, tabId: "http-tab" },
    });
    const before = createEmptyCanvasDocumentV2();
    const after = { ...before, nodes: [{ id: "prompt", type: "prompt" as const, position: { x: 0, y: 0 }, data: { kind: "prompt" as const, text: "HTTP save" } }] };
    const fetcher = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      expect(records.size).toBe(1);
      expect(put).toHaveBeenCalled();
      expect(validate(JSON.parse(String(init?.body)).clientMutationId)).toBe(true);
      return new Response(JSON.stringify({ success: true, revision: "2" }));
    });
    const result = await submitCanvasDocumentChange({ canvasId: 2, baseRevision: "1", clientSequence: 0, before, after, journal, fetcher, sessionId: "http-session" });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledOnce();
    expect(result).toEqual({ revision: "2", clientSequence: 1, document: after });
  });
});
