import { describe, expect, it } from "vitest";
import { createEmptyCanvasDocumentV2 } from "@/lib/canvas/document";
import {
  CanvasSnapshotCodecError,
  buildCanvasSnapshot,
  decodeCanvasSnapshot,
} from "@/lib/canvas/snapshot-codec";

describe("canvas snapshot codec", () => {
  it("builds deterministic immutable gzip snapshots with a content checksum", () => {
    const document = createEmptyCanvasDocumentV2();
    document.nodes.push({
      id: "a",
      type: "prompt",
      position: { x: 1, y: 2 },
      data: { kind: "prompt", text: "snapshot" },
    });

    const first = buildCanvasSnapshot(document, "17");
    const second = buildCanvasSnapshot(document, "17");

    expect(first.checksumSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(first.compressedJson).toEqual(second.compressedJson);
    expect(first.uncompressedBytes).toBeGreaterThan(0);
    expect(first.revision).toBe("17");
    expect(decodeCanvasSnapshot(first)).toEqual(document);
  });

  it("detects corrupted bytes before parsing the snapshot", () => {
    const snapshot = buildCanvasSnapshot(createEmptyCanvasDocumentV2(), "1");
    snapshot.compressedJson[snapshot.compressedJson.length - 1] ^= 1;
    expect(() => decodeCanvasSnapshot(snapshot)).toThrowError(
      expect.objectContaining({ code: "SNAPSHOT_DECOMPRESSION_FAILED" }),
    );
    expect(CanvasSnapshotCodecError).toBeTypeOf("function");
  });

  it("rejects invalid decimal revisions", () => {
    expect(() => buildCanvasSnapshot(createEmptyCanvasDocumentV2(), "1.5")).toThrowError(
      expect.objectContaining({ code: "SNAPSHOT_REVISION_INVALID" }),
    );
  });
});
