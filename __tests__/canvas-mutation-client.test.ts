import { describe, expect, it, vi } from "vitest";
import { createEmptyCanvasDocumentV2, type CanvasDocumentV2 } from "@/lib/canvas/document";
import { createCanvasDraftJournal, type CanvasDraftCommand, type CanvasDraftDriver } from "@/lib/canvas/draft-store";
import { submitCanvasDocumentChange, CanvasMutationHttpError } from "@/lib/canvas/mutation-client";
import { applyCanvasOperations } from "@/lib/canvas/operations";
import { validateCanvasDocumentBudget } from "@/lib/canvas/limits";
import { validateCanvasMutationBatch } from "@/lib/canvas/operations";
import { diffCanvasDocumentsToOperations } from "@/lib/canvas/document-diff";

function memoryDriver() {
  const records = new Map<string, CanvasDraftCommand>();
  const driver: CanvasDraftDriver = {
    async list(scope) {
      return [...records.values()].filter((item) => item.scopeKey.includes(`:${scope.canvasId}:`));
    },
    async put(command) { records.set(command.recordKey, command); },
    async delete(key) { records.delete(key); },
  };
  return { driver, records };
}

function documentWithNodes(count: number): CanvasDocumentV2 {
  const document = createEmptyCanvasDocumentV2();
  document.nodes = Array.from({ length: count }, (_, index) => ({
    id: `n-${index}`,
    type: "prompt" as const,
    position: { x: 0, y: 0 },
    data: { kind: "prompt" as const, text: String(index) },
  }));
  return document;
}

describe("canvas mutation client", () => {
  it("persists imported Markdown beyond the old text and mutation budgets, including later edits", async () => {
    const { driver } = memoryDriver();
    const journal = createCanvasDraftJournal({ driver, scope: { authUserId: 1, canvasId: 2, tabId: "markdown" } });
    let persisted = createEmptyCanvasDocumentV2();
    const content = "# 长篇故事\n\n" + "中文剧情与对白。\n".repeat(4000);
    let before = persisted;
    for (const text of [content, content + "\n结尾修改已保存"]) {
      const after: CanvasDocumentV2 = { ...before, nodes: [{ id: "md", type: "prompt", position: { x: 0, y: 0 },
        data: { kind: "prompt", format: "markdown", title: "故事.md", text } }] };
      const saved = await submitCanvasDocumentChange({
        canvasId: 2, baseRevision: "1", clientSequence: 0, before, after, journal, sessionId: "session",
        fetcher: async (_url, init) => {
          const { operations } = JSON.parse(String(init?.body));
          validateCanvasMutationBatch(operations);
          const next = applyCanvasOperations(persisted, operations);
          validateCanvasDocumentBudget(next);
          persisted = JSON.parse(JSON.stringify(next));
          return new Response(JSON.stringify({ success: true, revision: "2" }));
        },
      });
      expect(persisted.nodes[0].data).toMatchObject({ text, title: "故事.md", format: "markdown" });
      expect(saved.document).toEqual(persisted);
      expect(await journal.pending()).toEqual([]);
      before = saved.document;
    }
  });

  it("recovers an interrupted fetch from the durable draft with the same mutation identity", async () => {
    const { driver, records } = memoryDriver();
    const scope = { authUserId: 1, canvasId: 2, tabId: "tab" };
    const before = documentWithNodes(1);
    const after = { ...before, nodes: [{ ...before.nodes[0], position: { x: 4, y: 5 } }] };
    let interruptedId = "";
    await expect(submitCanvasDocumentChange({
      canvasId: 2, baseRevision: "1", clientSequence: 0, before, after,
      journal: createCanvasDraftJournal({ driver, scope }), sessionId: "session-current",
      fetcher: async (_url, init) => {
        interruptedId = JSON.parse(String(init?.body)).clientMutationId;
        expect(records.size).toBe(1);
        throw new DOMException("Navigation interrupted the request", "AbortError");
      },
    })).rejects.toMatchObject({ name: "AbortError" });
    const journal = createCanvasDraftJournal({ driver, scope });
    expect(await journal.recover(before)).toEqual(after);
    const requests: string[] = [];
    const saved = await submitCanvasDocumentChange({
      canvasId: 2, baseRevision: "1", clientSequence: 0, before, after, journal,
      sessionId: "session-new",
      fetcher: async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        requests.push(body.clientMutationId);
        expect(new Headers(init?.headers).get("X-Canvas-Session-Id")).toBe("session-new");
        expect(applyCanvasOperations(before, body.operations)).toEqual(after);
        return new Response(JSON.stringify({ success: true, revision: "2" }));
      },
    });
    expect(requests).toEqual([interruptedId]);
    expect(saved.document).toEqual(after);
    expect(records.size).toBe(0);
  });

  it("saves a workflow whose full request exceeds the keepalive quota without losing later edges", async () => {
    const { driver, records } = memoryDriver();
    const journal = createCanvasDraftJournal({ driver, scope: { authUserId: 1, canvasId: 2, tabId: "import" } });
    const before = createEmptyCanvasDocumentV2();
    const after = documentWithNodes(12);
    // Four legal text nodes nearly fill the operations budget; the request
    // envelope then pushes the actual UTF-8 body over the browser quota.
    after.nodes = after.nodes.map(node => ({ ...node, data: { kind: "prompt", text: "" } }));
    after.edges = after.nodes.slice(1).map((node, index) => ({ id: `e-${index}`, source: after.nodes[index].id, target: node.id }));
    const firstBatch = diffCanvasDocumentsToOperations(before, { ...after, nodes: after.nodes.slice(0, 4), edges: [] }, "change:0");
    const payloadBytes = 65500 - new TextEncoder().encode(JSON.stringify(firstBatch)).byteLength;
    for (let index = 0; index < 4; index++) {
      const bytes = Math.floor(payloadBytes / 4) + (index < payloadBytes % 4 ? 1 : 0);
      after.nodes[index].data = { kind: "prompt", text: "中".repeat(Math.floor(bytes / 3)) + "a".repeat(bytes % 3) };
    }
    let persisted = before;
    let revision = 1;
    const sizes: number[] = [];
    const result = await submitCanvasDocumentChange({
      canvasId: 2, baseRevision: "1", clientSequence: 0, before, after, journal, sessionId: "current",
      fetcher: async (_url, init) => {
        const body = String(init?.body);
        const size = new TextEncoder().encode(body).byteLength;
        sizes.push(size);
        if (init?.keepalive && size > 65536) throw new TypeError("keepalive quota exceeded");
        expect(init?.keepalive).not.toBe(true);
        const request = JSON.parse(body);
        persisted = applyCanvasOperations(persisted, request.operations);
        return new Response(JSON.stringify({ success: true, revision: String(++revision) }));
      },
    });
    expect(result.document).toEqual(after);
    expect(persisted).toEqual(after);
    expect(records.size).toBe(0);
    expect(sizes.length).toBeGreaterThan(1);
    expect(sizes.some(size => size > 65536)).toBe(true);
  });

  it("writes each bounded batch to WAL before sending and advances string revisions", async () => {
    const { driver, records } = memoryDriver();
    const journal = createCanvasDraftJournal({ driver, scope: { authUserId: 1, canvasId: 2, tabId: "tab" } });
    const before = documentWithNodes(120);
    const after = { ...before, nodes: before.nodes.map((node, index) => ({ ...node, position: { x: index + 1, y: index } })) };
    let revision = 5;
    const fetcher = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      expect(records.size).toBe(1);
      expect(new Headers(init?.headers).get("X-Canvas-Session-Id")).toBe("session-current");
      const body = JSON.parse(String(init?.body));
      expect(body.baseRevision).toBe(String(revision));
      revision += 1;
      return new Response(JSON.stringify({ success: true, revision: String(revision), idempotent: false }), { status: 200 });
    });

    const result = await submitCanvasDocumentChange({
      canvasId: 2,
      baseRevision: "5",
      clientSequence: 0,
      before,
      after,
      journal,
      fetcher,
      sessionId: "session-current",
      mutationId: (() => { let value = 0; return () => `123e4567-e89b-42d3-a456-${String(value += 1).padStart(12, "0")}`; })(),
    });

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(result.revision).toBe("7");
    expect(result.document).toEqual(after);
    expect(result.clientSequence).toBe(2);
    expect(records.size).toBe(0);
  });

  it("keeps a failed request in WAL with a typed conflict payload", async () => {
    const { driver, records } = memoryDriver();
    const journal = createCanvasDraftJournal({ driver, scope: { authUserId: 1, canvasId: 2, tabId: "tab" } });
    const before = documentWithNodes(1);
    const after = { ...before, nodes: [{ ...before.nodes[0], position: { x: 2, y: 3 } }] };

    await expect(submitCanvasDocumentChange({
      canvasId: 2,
      baseRevision: "5",
      clientSequence: 0,
      before,
      after,
      journal,
      fetcher: vi.fn().mockResolvedValue(new Response(JSON.stringify({
        success: false,
        code: "CANVAS_REVISION_CONFLICT",
        currentRevision: "6",
        missingMutations: [],
      }), { status: 409 })),
      sessionId: "session-current",
      mutationId: () => "123e4567-e89b-42d3-a456-426614174000",
    })).rejects.toEqual(expect.objectContaining({
      code: "CANVAS_REVISION_CONFLICT",
      status: 409,
      details: expect.objectContaining({ currentRevision: "6" }),
    }));
    expect(records.size).toBe(1);
    expect(CanvasMutationHttpError).toBeTypeOf("function");
  });

  it("flushes an overloaded WAL command before computing a new diff", async () => {
    const { driver, records } = memoryDriver();
    const journal = createCanvasDraftJournal({ driver, scope: { authUserId: 1, canvasId: 2, tabId: "tab" } });
    const before = documentWithNodes(1);
    const after = { ...before, nodes: [{ ...before.nodes[0], position: { x: 4, y: 5 } }] };
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        success: false,
        code: "CANVAS_MUTATION_OVERLOADED",
      }), { status: 429, headers: { "Retry-After": "2" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, revision: "6" }), { status: 200 }));
    let mutationSequence = 0;
    const mutationId = () => `123e4567-e89b-42d3-a456-${String(mutationSequence += 1).padStart(12, "0")}`;

    await expect(submitCanvasDocumentChange({
      canvasId: 2,
      baseRevision: "5",
      clientSequence: 0,
      before,
      after,
      journal,
      fetcher,
      sessionId: "session-current",
      mutationId,
    })).rejects.toEqual(expect.objectContaining({
      code: "CANVAS_MUTATION_OVERLOADED",
      details: expect.objectContaining({ retryAfterMs: 2_000 }),
    }));
    expect(records.size).toBe(1);

    const recovered = await submitCanvasDocumentChange({
      canvasId: 2,
      baseRevision: "5",
      clientSequence: 0,
      before,
      after,
      journal,
      fetcher,
      sessionId: "session-current",
      mutationId,
    });

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(recovered).toEqual({ revision: "6", clientSequence: 1, document: after });
    expect(records.size).toBe(0);
  });

  it("refuses to send a mutation without a non-empty editor session token", async () => {
    const { driver } = memoryDriver();
    const journal = createCanvasDraftJournal({ driver, scope: { authUserId: 1, canvasId: 2, tabId: "tab" } });
    const before = documentWithNodes(1);
    const after = { ...before, nodes: [{ ...before.nodes[0], position: { x: 4, y: 5 } }] };
    const fetcher = vi.fn();

    await expect(submitCanvasDocumentChange({
      canvasId: 2,
      baseRevision: "5",
      clientSequence: 0,
      before,
      after,
      journal,
      fetcher,
      sessionId: "   ",
      mutationId: () => "123e4567-e89b-42d3-a456-426614174000",
    })).rejects.toMatchObject({ code: "CANVAS_SESSION_EXPIRED", status: 409 });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
