import { describe, expect, it } from "vitest";
import { createEmptyCanvasDocumentV2 } from "@/lib/canvas/document";
import { parseCanvasJson, validateCanvasArchiveEntries } from "@/lib/canvas/transfer";
import * as transferOperations from "@/lib/canvas/transfer";

describe("canvas v2 import safety", () => {
  it("accepts only a valid v2 document within the JSON size limit", () => {
    const document = createEmptyCanvasDocumentV2();
    expect(parseCanvasJson(JSON.stringify(document))).toEqual(document);
    expect(() => parseCanvasJson("{}")) .toThrow(/V2/);
    expect(() => parseCanvasJson("x".repeat(5 * 1024 * 1024 + 1))).toThrow(/过大/);
  });

  it("rejects path traversal, absolute paths, excessive files, and excessive uncompressed size", () => {
    expect(() => validateCanvasArchiveEntries([{ name: "../secret", size: 1 }])).toThrow(/路径/);
    expect(() => validateCanvasArchiveEntries([{ name: "C:/secret", size: 1 }])).toThrow(/路径/);
    expect(() => validateCanvasArchiveEntries(Array.from({ length: 2003 }, (_, index) => ({ name: `resources/${index}.png`, size: 1 })))).toThrow(/文件数量/);
    const limit = 10 * 1024 * 1024 * 1024;
    expect(validateCanvasArchiveEntries([{ name: "resources/video.mp4", size: limit }]).totalSize).toBe(limit);
    expect(() => validateCanvasArchiveEntries([{ name: "resources/video.mp4", size: limit }, { name: "workflow.json", size: 1 }])).toThrow(/上限 10 GB/);
    expect(validateCanvasArchiveEntries([{ name: "workflow.json", size: 100 }, { name: "resources/a.png", size: 200 }])).toEqual({ fileCount: 2, totalSize: 300 });
  });

  it("exports the selected subgraph including descendants and internal edges only", () => {
    const selectCanvasSubgraph = (transferOperations as any).selectCanvasSubgraph;
    expect(typeof selectCanvasSubgraph).toBe("function");
    if (typeof selectCanvasSubgraph !== "function") return;

    const document = createEmptyCanvasDocumentV2();
    document.nodes = [
      { id: "group", type: "group", position: { x: 20, y: 30 }, data: { kind: "group", title: "组", collapsed: false } },
      { id: "child", type: "prompt", parentId: "group", extent: "parent", position: { x: 24, y: 52 }, data: { kind: "prompt", text: "child" } },
      { id: "outside", type: "prompt", position: { x: 600, y: 40 }, data: { kind: "prompt", text: "outside" } },
    ];
    document.edges = [
      { id: "inside", source: "group", target: "child" },
      { id: "outside-edge", source: "child", target: "outside" },
    ];

    const selected = selectCanvasSubgraph(document, ["group"]);
    expect(selected.nodes.map((node: any) => node.id)).toEqual(["group", "child"]);
    expect(selected.edges.map((edge: any) => edge.id)).toEqual(["inside"]);
  });

  it("appends imported nodes with remapped ids and leaves the current document intact", () => {
    const appendCanvasDocument = (transferOperations as any).appendCanvasDocument;
    expect(typeof appendCanvasDocument).toBe("function");
    if (typeof appendCanvasDocument !== "function") return;

    const current = createEmptyCanvasDocumentV2();
    current.nodes = [{ id: "existing", type: "prompt", position: { x: 0, y: 0 }, data: { kind: "prompt", text: "existing" } }];
    const imported = createEmptyCanvasDocumentV2();
    imported.nodes = [
      { id: "group", type: "group", position: { x: 20, y: 20 }, data: { kind: "group", title: "组", collapsed: false } },
      { id: "child", type: "prompt", parentId: "group", extent: "parent", position: { x: 24, y: 52 }, data: { kind: "prompt", text: "imported" } },
    ];
    imported.edges = [{ id: "edge", source: "group", target: "child" }];

    const appended = appendCanvasDocument(current, imported, { x: 100, y: 80 });
    expect(appended.nodes).toHaveLength(3);
    expect(appended.nodes[0]).toEqual(current.nodes[0]);
    const appendedGroup = appended.nodes.find((node: any) => node.type === "group")!;
    const appendedChild = appended.nodes.find((node: any) => node.data.kind === "prompt" && node.data.text === "imported")!;
    expect(appendedGroup.id).not.toBe("group");
    expect(appendedGroup.position.x >= 500 || appendedGroup.position.y >= 500).toBe(true);
    expect(appendedChild.parentId).toBe(appendedGroup.id);
    expect(appendedChild.position).toEqual({ x: 24, y: 52 });
    expect(appended.edges[0]).toMatchObject({ source: appendedGroup.id, target: appendedChild.id });
  });
  it("places repeated appended workflows in free space while preserving their internal layout", () => {
    const current = createEmptyCanvasDocumentV2();
    current.nodes = [{ id: "existing", type: "image", position: { x: -500, y: -500 }, width: 2000, height: 2000, data: { kind: "image", url: "/old.png" } }];
    const imported = createEmptyCanvasDocumentV2();
    imported.nodes = [0, 1].map(i => ({ id: `new-${i}`, type: "image", position: { x: -300 + i * 450, y: -200 }, width: 350, height: 600, data: { kind: "image", url: `/new-${i}.png` } }));
    const once = transferOperations.appendCanvasDocument(current, imported);
    const twice = transferOperations.appendCanvasDocument(once, imported);
    expect(twice.nodes[0]).toEqual(current.nodes[0]);
    for (let i = 1; i < twice.nodes.length; i++) {
      const a = twice.nodes[i];
      for (let j = 0; j < i; j++) {
        const b = twice.nodes[j];
        expect(a.position.x >= b.position.x + b.width! || b.position.x >= a.position.x + a.width!
          || a.position.y >= b.position.y + b.height! || b.position.y >= a.position.y + a.height!).toBe(true);
      }
    }
    expect(twice.nodes[2].position.x - twice.nodes[1].position.x).toBe(450);
    expect(twice.nodes[4].position.x - twice.nodes[3].position.x).toBe(450);
    expect(imported.nodes[0].position).toEqual({ x: -300, y: -200 });
  });
});
