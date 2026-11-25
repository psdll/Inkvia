import { afterEach, describe, expect, it, vi } from "vitest";
import JSZip from "jszip";
import { File } from "node:buffer";
import { createEmptyCanvasDocumentV2, type CanvasDocumentV2 } from "@/lib/canvas/document";
import { createWorkflowArchive, readWorkflowFile } from "@/lib/canvas/workflow-archive";
import { appendCanvasDocument, selectCanvasSubgraph, detachWorkflowExecution } from "@/lib/canvas/transfer";

afterEach(() => vi.unstubAllGlobals());
const asFile = (blob: Blob, name = "test.canvas.zip") => new File([blob as unknown as import("node:buffer").Blob], name) as unknown as globalThis.File;
const imageDocument = (): CanvasDocumentV2 => ({ ...createEmptyCanvasDocumentV2(), nodes: [
  { id: "image", type: "image", position: { x: 10, y: 20 }, data: { kind: "image", url: "/old.jpg", variants: { thumbnail: { url: "/old-thumb.jpg" } } } },
] });

describe("workflow files round trip", () => {
  it("reads compressed legacy ZIPs without reading the entire archive into an ArrayBuffer", async () => {
    vi.stubGlobal("File", File);
    const zip = new JSZip();
    zip.file("workflow.json", JSON.stringify(imageDocument()));
    zip.file("manifest.json", JSON.stringify({ version: 2, resources: [
      { url: "/old.jpg", path: "resources/image.jpg", kind: "image", mimeType: "image/jpeg" },
    ] }));
    zip.file("resources/image.jpg", "legacy image contents".repeat(1000));
    zip.file("resources/unused.bin", new Uint8Array(1024 * 1024), { compression: "STORE" });
    const file = asFile(await zip.generateAsync({ type: "blob", compression: "DEFLATE" }));
    const readWholeFile = vi.spyOn(file, "arrayBuffer").mockRejectedValue(new Error("whole archive read forbidden"));
    const upload = vi.fn(async (media: globalThis.File) => {
      expect(await media.text()).toBe("legacy image contents".repeat(1000));
      return { url: "/new.jpg" };
    });
    const imported = await readWorkflowFile(file, upload);
    expect(readWholeFile).not.toHaveBeenCalled();
    expect(imported.nodes[0].data).toMatchObject({ url: "/new.jpg" });
  });

  it("rejects damaged material bytes before uploading that material", async () => {
    vi.stubGlobal("File", File);
    const zip = new JSZip();
    zip.file("workflow.json", JSON.stringify(imageDocument()));
    zip.file("manifest.json", JSON.stringify({ version: 2, resources: [
      { url: "/old.jpg", path: "resources/image.jpg", kind: "image", mimeType: "image/jpeg" },
    ] }));
    zip.file("resources/image.jpg", "unique material contents");
    const bytes = await zip.generateAsync({ type: "nodebuffer", compression: "STORE" });
    bytes[bytes.indexOf("unique material contents")] ^= 1;
    const upload = vi.fn();
    await expect(readWorkflowFile(asFile(new Blob([new Uint8Array(bytes)])), upload)).rejects.toThrow();
    expect(upload).not.toHaveBeenCalled();
  });

  it("round trips 300 distinct resources with bounded concurrency, node layout and connections intact", async () => {
    vi.stubGlobal("File", File);
    const doc = createEmptyCanvasDocumentV2();
    doc.nodes = Array.from({ length: 300 }, (_, index) => ({ id: `image-${index}`, type: "image" as const,
      position: { x: index % 20 * 400, y: Math.floor(index / 20) * 500 }, width: 350, height: 450,
      data: { kind: "image" as const, url: `/image-${index}.png` } }));
    doc.edges = doc.nodes.slice(1).map((node, index) => ({ id: `edge-${index}`, source: doc.nodes[index].id, target: node.id }));
    let active = 0, peak = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      active++; peak = Math.max(peak, active);
      await new Promise(resolve => setTimeout(resolve, 1)); active--;
      return new Response(new TextEncoder().encode(url), { headers: { "content-type": "image/png" } });
    }));
    const progress = vi.fn();
    const archive = await createWorkflowArchive(doc, progress);
    expect(peak).toBe(6);
    expect(progress).toHaveBeenCalledWith("正在读取素材 300/300");
    peak = 0;
    const upload = vi.fn(async (file: globalThis.File) => {
      active++; peak = Math.max(peak, active);
      const original = await file.text();
      await new Promise(resolve => setTimeout(resolve, 1)); active--;
      return { url: `/copied${original}`, mediaId: original };
    });
    const imported = await readWorkflowFile(asFile(archive), upload, progress);
    expect(progress).toHaveBeenCalledWith("正在导入素材 300/300");
    expect(upload).toHaveBeenCalledTimes(300);
    expect(peak).toBe(8);
    expect(imported.edges).toEqual(doc.edges);
    imported.nodes.forEach((node, index) => {
      expect(node.position).toEqual(doc.nodes[index].position);
      expect(node.data).toMatchObject({ url: `/copied/image-${index}.png`, mediaId: `/image-${index}.png` });
    });
  });
  it("limits simultaneous large-file extraction and upload by byte budget", async () => {
    vi.stubGlobal("File", File);
    const doc = imageDocument();
    doc.nodes = Array.from({ length: 3 }, (_, i) => ({ ...doc.nodes[0], id: `image-${i}`, data: { kind: "image" as const, url: `/large-${i}.png` } }));
    const zip = new JSZip();
    zip.file("workflow.json", JSON.stringify(doc));
    const resources = doc.nodes.map((_, i) => ({ url: `/large-${i}.png`, path: `resources/${i}.png`, kind: "image", mimeType: "image/png" }));
    zip.file("manifest.json", JSON.stringify({ version: 2, resources }));
    for (const resource of resources) zip.file(resource.path, new Uint8Array(24 * 1024 * 1024));
    let active = 0, peak = 0;
    const result = await readWorkflowFile(asFile(await zip.generateAsync({ type: "blob", compression: "STORE" })), async file => {
      active++; peak = Math.max(peak, active);
      expect(file.size).toBe(24 * 1024 * 1024);
      await new Promise(resolve => setTimeout(resolve, 5));
      active--;
      return { url: `/new/${file.name}` };
    });
    expect(peak).toBeLessThanOrEqual(2);
    expect(result.nodes).toHaveLength(3);
  });
  const runningDocument = (): CanvasDocumentV2 => {
    const settings = { model: "test", prompt: "keep me", aspectRatio: "9:16", resolution: "2K", quality: "", count: 2 };
    return { ...createEmptyCanvasDocumentV2(), nodes: [
      { id: "task", type: "imageTask", position: { x: 0, y: 0 }, data: { kind: "imageTask", task: {
        settings, references: [], batches: [{ id: "batch", createdAt: 1, settings, outputs: [
          { id: "done", status: "success", url: "/done.png", generationId: 10 },
          { id: "pending", status: "running", generationId: 11, startedAt: 1 },
        ] }],
      } } },
      { id: "video", type: "videoTask", position: { x: 400, y: 0 }, data: {
        kind: "videoTask", model: "test", prompt: "keep video", mediaPaths: [], status: "submitting", generationId: 12,
      } },
      { id: "llm", type: "llm", position: { x: 800, y: 0 }, data: { kind: "llm", prompt: "keep prompt", status: "running", output: "partial" } },
    ] };
  };
  it("detaches execution without mutating the original canvas or losing successful results", () => {
    const source = runningDocument();
    const clean = detachWorkflowExecution(source);
    expect(clean.nodes[0].data).toMatchObject({ task: { settings: { prompt: "keep me" }, batches: [{ outputs: [{ id: "done", status: "success", url: "/done.png" }] }] } });
    expect(JSON.stringify(clean)).not.toContain("generationId");
    expect(JSON.stringify(clean)).not.toContain('"running"');
    expect(clean.nodes[1].data).toMatchObject({ status: "idle", prompt: "keep video" });
    expect(clean.nodes[2].data).not.toHaveProperty("output");
    expect(JSON.stringify(source)).toContain('"running"');
    expect(appendCanvasDocument(createEmptyCanvasDocumentV2(), source).nodes[1].data).toMatchObject({ status: "idle" });
  });
  it.each(["zip"])("cleans running jobs from old %s exports on import", async extension => {
    vi.stubGlobal("File", File);
    const text = JSON.stringify(runningDocument());
    const zip = new JSZip(); zip.file("workflow.json", text);
    const file = extension === "zip" ? asFile(await zip.generateAsync({ type: "blob" }))
      : new File([text], "old.json") as unknown as globalThis.File;
    const result = await readWorkflowFile(file, vi.fn());
    expect(result).toEqual(detachWorkflowExecution(runningDocument()));
  });
  it("does not export active execution identities in ZIP workflow JSON", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array([1]), { headers: { "content-type": "image/png" } })));
    const archive = await createWorkflowArchive(runningDocument());
    const zip = await JSZip.loadAsync(await archive.arrayBuffer());
    expect(JSON.parse(await zip.file("workflow.json")!.async("string"))).toEqual(detachWorkflowExecution(runningDocument()));
  });
  it("preserves media bytes and MIME types, deduplicates task references, and restores generated outputs", async () => {
    const doc = imageDocument();
    doc.nodes.push({ id: "task", type: "imageTask", position: { x: 300, y: 0 }, data: { kind: "imageTask", task: {
      references: [{ id: "image", sourceNodeId: "image", name: "reference", url: "/old.jpg" }], referenceOrder: ["image"],
      settings: { model: "test", prompt: "keep /old.jpg text", aspectRatio: "1:1", resolution: "1K", quality: "", count: 1 },
      batches: [{ id: "batch", createdAt: 1, settings: { model: "test", prompt: "", aspectRatio: "1:1", resolution: "1K", quality: "", count: 1 }, outputs: [{ id: "out", status: "success", url: "/output.webp" }] }],
    } } });
    doc.nodes.push({ id: "video", type: "videoTask", position: { x: 600, y: 0 }, data: { kind: "videoTask", model: "test", prompt: "", status: "success", mediaPaths: ["/old.jpg", "/ref.wav"], referenceOrder: ["configured:/ref.wav"], outputUrl: "/output.webm" } });
    const contents = new Map([
      ["/old.jpg", { mime: "image/jpeg", bytes: [255, 216, 255, 1] }],
      ["/output.webp", { mime: "image/webp", bytes: [82, 73, 70, 70, 2] }],
      ["/ref.wav", { mime: "audio/wav", bytes: [82, 73, 70, 70, 3] }],
      ["/output.webm", { mime: "video/webm", bytes: [26, 69, 223, 163, 4] }],
    ]);
    const fetcher = vi.fn(async (url: string) => { const item = contents.get(url)!; return new Response(new Uint8Array(item.bytes), { headers: { "content-type": item.mime } }); });
    vi.stubGlobal("fetch", fetcher);
    vi.stubGlobal("File", File);
    const archive = await createWorkflowArchive(doc);
    expect(fetcher).toHaveBeenCalledTimes(4);
    const uploads: globalThis.File[] = [];
    const imported = await readWorkflowFile(asFile(archive), async file => {
      uploads.push(file);
      const source = [...contents].find(([, item]) => item.mime === file.type)!;
      expect([...new Uint8Array(await file.arrayBuffer())]).toEqual(source[1].bytes);
      return { url: `/new${source[0]}`, variants: { thumbnail: { url: "/new-thumb.jpg" } } };
    });
    expect(uploads.map(file => file.type).sort()).toEqual([...contents.values()].map(item => item.mime).sort());
    expect(imported.nodes[0].data).toMatchObject({ url: "/new/old.jpg", variants: { thumbnail: { url: "/new-thumb.jpg" } } });
    const task = imported.nodes[1].data;
    expect(task.kind === "imageTask" && task.task.references[0].url).toBe("/new/old.jpg");
    expect(task.kind === "imageTask" && task.task.batches[0].outputs[0].url).toBe("/new/output.webp");
    expect(task.kind === "imageTask" && task.task.settings.prompt).toBe("keep /old.jpg text");
    expect(imported.nodes[2].data).toMatchObject({ outputUrl: "/new/output.webm", mediaPaths: ["/new/old.jpg", "/new/ref.wav"], referenceOrder: ["configured:/new/ref.wav"] });
    const appended = appendCanvasDocument(imageDocument(), imported);
    const copiedTask = appended.nodes.find(node => node.data.kind === "imageTask")!;
    if (copiedTask.data.kind === "imageTask") {
      expect(copiedTask.data.task.references[0].sourceNodeId).toBe(appended.nodes[1].id);
      expect(copiedTask.data.task.referenceOrder).toEqual([appended.nodes[1].id]);
    }
  });

  it("imports legacy ZIP resources with an explicit media type rather than octet-stream", async () => {
    vi.stubGlobal("File", File);
    const zip = new JSZip();
    zip.file("workflow.json", JSON.stringify(imageDocument()));
    zip.file("manifest.json", JSON.stringify({ version: 1, resources: { image: "resources/image.png" } }));
    zip.file("resources/image.png", new Uint8Array([255, 216, 255]));
    const upload = vi.fn(async (file: globalThis.File) => { expect(file.type).toBe("image/jpeg"); return { url: "/restored.jpg" }; });
    const imported = await readWorkflowFile(asFile(await zip.generateAsync({ type: "blob" })), upload);
    expect(imported.nodes[0].data).toMatchObject({ url: "/restored.jpg" });
    expect(imported.nodes[0].data).not.toHaveProperty("variants");
  });

  it("does not silently export missing or non-media resources", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("missing", { status: 404 })));
    await expect(createWorkflowArchive(imageDocument())).rejects.toThrow("素材读取失败");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>login</html>", { headers: { "content-type": "text/html" } })));
    await expect(createWorkflowArchive(imageDocument())).rejects.toThrow("非媒体内容");
  });

  it("rejects missing archive resources before performing uploads", async () => {
    const zip = new JSZip();
    zip.file("workflow.json", JSON.stringify(imageDocument()));
    zip.file("manifest.json", JSON.stringify({ version: 1, resources: { image: "resources/missing.png" } }));
    const upload = vi.fn();
    await expect(readWorkflowFile(asFile(await zip.generateAsync({ type: "blob" })), upload)).rejects.toThrow("缺少素材");
    expect(upload).not.toHaveBeenCalled();
  });

  it("rejects JSON and unrelated files without uploading", async () => {
    const doc = imageDocument(); const upload = vi.fn();
    await expect(readWorkflowFile(asFile(new Blob([JSON.stringify(doc)]), "test.json"), upload)).rejects.toThrow("ZIP");
    expect(upload).not.toHaveBeenCalled();
    await expect(readWorkflowFile(asFile(new Blob(["{}"]), "test.txt"), upload)).rejects.toThrow("ZIP");
  });

  it("keeps detached child nodes visible and at their world position", () => {
    const doc = imageDocument();
    doc.nodes[0].parentId = "group"; doc.nodes[0].hidden = true;
    doc.nodes.push({ id: "group", type: "group", position: { x: 100, y: 200 }, data: { kind: "group", title: "group", collapsed: true } });
    expect(selectCanvasSubgraph(doc, ["image"]).nodes[0]).toMatchObject({ position: { x: 110, y: 220 }, hidden: false, parentId: undefined });
  });
});
