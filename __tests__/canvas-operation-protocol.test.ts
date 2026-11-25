import { describe, expect, it } from "vitest";
import { createEmptyCanvasDocumentV2, type CanvasDocumentV2, type CanvasNode } from "@/lib/canvas/document";
import {
  CANVAS_OPERATION_PROTOCOL_VERSION,
  CanvasOperationError,
  applyCanvasOperations,
  getCanvasOperationTouchedPaths,
  validateCanvasMutationBatch,
  type CanvasOperation,
} from "@/lib/canvas/operations";
import { rebaseCanvasOperations } from "@/lib/canvas/rebase";
import {
  CanvasProtocolVersionError,
  migrateCanvasSnapshotToCurrent,
  migrateOperationBatchToCurrent,
} from "@/lib/canvas/protocol-migrations";
import {
  CANVAS_MAX_DOCUMENT_BYTES,
  CANVAS_MAX_MUTATION_BYTES,
  CANVAS_MAX_NODE_BYTES,
  CANVAS_MAX_TEXT_BYTES,
  CANVAS_MAX_MARKDOWN_TEXT_BYTES,
  validateCanvasDocumentBudget,
  validateCanvasNodeBudget,
} from "@/lib/canvas/limits";

function promptNode(id: string, text = "hello"): CanvasNode {
  return { id, type: "prompt", position: { x: 0, y: 0 }, data: { kind: "prompt", text } };
}

function documentWithNodes(...nodes: CanvasNode[]): CanvasDocumentV2 {
  return { ...createEmptyCanvasDocumentV2(), nodes };
}

describe("canvas operation protocol", () => {
  it("applies an ordered batch deterministically and cascades node deletion to incident edges", () => {
    const document = documentWithNodes(promptNode("a"), promptNode("b"));
    document.edges = [{ id: "e1", source: "a", target: "b" }];
    const operations: CanvasOperation[] = [
      { opId: "1", kind: "node.move", nodeId: "a", position: { x: 120, y: 80 } },
      { opId: "2", kind: "node.patch", nodeId: "a", patch: { data: { text: "updated" } } },
      { opId: "3", kind: "canvas.settings.patch", patch: { snapToGrid: true } },
      { opId: "4", kind: "node.delete", nodeId: "b" },
    ];

    const first = applyCanvasOperations(document, operations);
    const replayed = applyCanvasOperations(document, operations);

    expect(first).toEqual(replayed);
    expect(first.nodes).toEqual([
      expect.objectContaining({ id: "a", position: { x: 120, y: 80 }, data: { kind: "prompt", text: "updated" } }),
    ]);
    expect(first.edges).toEqual([]);
    expect(first.settings.snapToGrid).toBe(true);
  });

  it("rejects duplicate entity creation and patches that change node kind", () => {
    const document = documentWithNodes(promptNode("a"));

    expect(() => applyCanvasOperations(document, [
      { opId: "1", kind: "node.create", node: promptNode("a") },
    ])).toThrowError(expect.objectContaining({ code: "NODE_ALREADY_EXISTS" }));

    expect(() => applyCanvasOperations(document, [
      { opId: "2", kind: "node.patch", nodeId: "a", patch: { data: { kind: "image" } } },
    ])).toThrowError(expect.objectContaining({ code: "NODE_KIND_IMMUTABLE" }));
  });

  it("returns stable touched paths without comparing whole documents", () => {
    expect(getCanvasOperationTouchedPaths({
      opId: "1",
      kind: "node.patch",
      nodeId: "a",
      patch: { zIndex: 4, data: { title: "A", text: "B" } },
    })).toEqual([
      "node:a.data.text",
      "node:a.data.title",
      "node:a.zIndex",
    ]);
  });

  it("enforces the operation count and serialized batch byte budgets", () => {
    const tooMany = Array.from({ length: 101 }, (_, index): CanvasOperation => ({
      opId: String(index),
      kind: "node.move",
      nodeId: `n${index}`,
      position: { x: index, y: 0 },
    }));
    expect(() => validateCanvasMutationBatch(tooMany)).toThrowError(
      expect.objectContaining({ code: "MUTATION_OPERATION_LIMIT" }),
    );

    const oversized: CanvasOperation[] = [{
      opId: "large",
      kind: "node.patch",
      nodeId: "a",
      patch: { data: { text: "x".repeat(CANVAS_MAX_MUTATION_BYTES) } },
    }];
    expect(() => validateCanvasMutationBatch(oversized)).toThrowError(
      expect.objectContaining({ code: "MUTATION_BYTE_LIMIT" }),
    );
  });
});

describe("canvas operation rebase", () => {
  it("keeps disjoint field updates and reports no conflict", () => {
    const result = rebaseCanvasOperations(
      [{ opId: "local", kind: "node.resize", nodeId: "a", width: 300, height: 200 }],
      [{ opId: "remote", kind: "node.patch", nodeId: "a", patch: { data: { title: "remote" } } }],
    );

    expect(result.operations).toHaveLength(1);
    expect(result.conflicts).toEqual([]);
    expect(result.dropped).toEqual([]);
  });

  it("requires manual resolution when both sides edit the same long-text field", () => {
    const result = rebaseCanvasOperations(
      [{ opId: "local", kind: "node.patch", nodeId: "a", patch: { data: { text: "local" } } }],
      [{ opId: "remote", kind: "node.patch", nodeId: "a", patch: { data: { text: "remote" } } }],
    );

    expect(result.operations).toEqual([]);
    expect(result.conflicts).toEqual([
      expect.objectContaining({ kind: "manual", entityId: "a", path: "node:a.data.text" }),
    ]);
  });

  it("lets remote deletion dominate stale local updates", () => {
    const local: CanvasOperation[] = [
      { opId: "local", kind: "node.move", nodeId: "a", position: { x: 1, y: 2 } },
    ];
    const remote: CanvasOperation[] = [{ opId: "remote", kind: "node.delete", nodeId: "a" }];

    const result = rebaseCanvasOperations(local, remote);

    expect(result.operations).toEqual([]);
    expect(result.dropped).toEqual([
      expect.objectContaining({ operation: local[0], reason: "REMOTE_NODE_DELETED" }),
    ]);
  });

  it("keeps a local delete after a remote patch", () => {
    const local: CanvasOperation[] = [{ opId: "local", kind: "node.delete", nodeId: "a" }];
    const remote: CanvasOperation[] = [
      { opId: "remote", kind: "node.patch", nodeId: "a", patch: { data: { title: "remote" } } },
    ];

    expect(rebaseCanvasOperations(local, remote).operations).toEqual(local);
  });

  it("drops an edge creation whose endpoint was deleted remotely", () => {
    const local: CanvasOperation[] = [{
      opId: "local",
      kind: "edge.create",
      edge: { id: "e1", source: "a", target: "b" },
    }];
    const remote: CanvasOperation[] = [{ opId: "remote", kind: "node.delete", nodeId: "b" }];

    const result = rebaseCanvasOperations(local, remote);

    expect(result.operations).toEqual([]);
    expect(result.conflicts).toEqual([
      expect.objectContaining({ kind: "structural", entityId: "e1", path: "edge:e1" }),
    ]);
  });
});

describe("canvas data budgets and protocol migration", () => {
  it("allows longer Markdown bodies without relaxing generation prompts or labels", () => {
    const node = promptNode("md", "中".repeat(13000));
    node.data = { ...node.data, format: "markdown" } as typeof node.data;
    expect(() => validateCanvasNodeBudget(node)).not.toThrow();
    const tooLong = { ...node, data: { ...node.data, text: "x".repeat(CANVAS_MAX_MARKDOWN_TEXT_BYTES + 1) } } as CanvasNode;
    expect(() => validateCanvasNodeBudget(tooLong)).toThrowError(expect.objectContaining({ code: "TEXT_BYTE_LIMIT" }));
    const longPrompt = { ...node, data: { ...node.data, prompt: "x".repeat(CANVAS_MAX_TEXT_BYTES + 1) } } as CanvasNode;
    expect(() => validateCanvasNodeBudget(longPrompt)).toThrowError(expect.objectContaining({ code: "TEXT_BYTE_LIMIT" }));
    const longTitle = { ...node, data: { ...node.data, title: "x".repeat(513) } } as CanvasNode;
    expect(() => validateCanvasNodeBudget(longTitle)).toThrowError(expect.objectContaining({ code: "LABEL_BYTE_LIMIT" }));
  });

  it("rejects oversized text, node, and document payloads with stable codes", () => {
    expect(() => validateCanvasNodeBudget(promptNode("a", "x".repeat(CANVAS_MAX_TEXT_BYTES + 1)))).toThrowError(
      expect.objectContaining({ code: "TEXT_BYTE_LIMIT" }),
    );

    const largeNode = promptNode("a");
    Object.assign(largeNode, { padding: "x".repeat(CANVAS_MAX_NODE_BYTES) });
    expect(() => validateCanvasNodeBudget(largeNode)).toThrowError(
      expect.objectContaining({ code: "NODE_BYTE_LIMIT" }),
    );

    const document = documentWithNodes(promptNode("a"));
    Object.assign(document, { padding: "x".repeat(CANVAS_MAX_DOCUMENT_BYTES) });
    expect(() => validateCanvasDocumentBudget(document)).toThrowError(
      expect.objectContaining({ code: "DOCUMENT_BYTE_LIMIT" }),
    );
  });

  it("accepts the current snapshot and operation protocol without rewriting them", () => {
    const snapshot = documentWithNodes(promptNode("a"));
    expect(migrateCanvasSnapshotToCurrent(snapshot)).toEqual(snapshot);

    const operations: CanvasOperation[] = [{
      opId: "1",
      kind: "node.move",
      nodeId: "a",
      position: { x: 1, y: 2 },
    }];
    expect(migrateOperationBatchToCurrent({
      protocolVersion: CANVAS_OPERATION_PROTOCOL_VERSION,
      operations,
    })).toEqual(operations);
  });

  it("fails closed for unknown future snapshot and operation versions", () => {
    expect(() => migrateCanvasSnapshotToCurrent({
      ...createEmptyCanvasDocumentV2(),
      schemaVersion: 99,
    })).toThrowError(expect.objectContaining({ code: "UNSUPPORTED_FUTURE_DOCUMENT_VERSION" }));

    expect(() => migrateOperationBatchToCurrent({ protocolVersion: 99, operations: [] })).toThrowError(
      expect.objectContaining({ code: "UNSUPPORTED_FUTURE_OPERATION_VERSION" }),
    );
  });

  it("uses typed errors for callers that need stable API codes", () => {
    expect(CanvasOperationError).toBeTypeOf("function");
    expect(CanvasProtocolVersionError).toBeTypeOf("function");
  });
});
