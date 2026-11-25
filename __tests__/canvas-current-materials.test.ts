import { describe, expect, it } from "vitest";
import { listCanvasCurrentMaterials, listCanvasMaterialRows } from "@/lib/canvas/current-materials";
import type { CanvasNode } from "@/lib/canvas/document";

describe("canvas material groups", () => {
  const nodes: CanvasNode[] = [
    { id: "loose", type: "image", position: { x: 0, y: 0 }, data: { kind: "image", url: "/loose.png", name: "未分组" } },
    { id: "group", type: "group", position: { x: 0, y: 0 }, data: { kind: "group", title: "产品", collapsed: true } },
    { id: "nested", parentId: "group", type: "group", position: { x: 0, y: 0 }, data: { kind: "group", title: "细节", collapsed: false } },
    { id: "image", parentId: "nested", type: "image", position: { x: 0, y: 0 }, data: { kind: "image", url: "/chair.png", name: "椅子" } },
    { id: "video", parentId: "group", type: "video", position: { x: 0, y: 0 }, data: { kind: "video", url: "/chair.mp4", name: "演示" } },
  ];
  const rows = (options = {}) => listCanvasMaterialRows(nodes, listCanvasCurrentMaterials(nodes), options);
  it("lists groups first, nests their media once, and keeps loose media at root", () => {
    expect(rows().map(row => [row.id, row.depth])).toEqual([
      ["group:group", 0], ["group:nested", 1], ["image", 2], ["video", 1], ["loose", 0],
    ]);
  });
  it("collapses the sidebar independently of canvas group visibility", () => {
    expect(rows({ collapsed: new Set(["group"]) }).map(row => row.id)).toEqual(["group:group", "loose"]);
  });
  it("reveals matching descendants and their ancestors even when collapsed", () => {
    expect(rows({ query: "椅子", collapsed: new Set(["group"]) }).map(row => row.id)).toEqual(["group:group", "group:nested", "image"]);
    expect(rows({ query: "产品", kind: "video" }).map(row => row.id)).toEqual(["group:group", "video"]);
    expect(rows({ kind: "audio" })).toEqual([]);
  });
  it("reflects rename, regroup and ungroup from updated live nodes", () => {
    const changed = nodes.filter(node => node.id !== "nested").map(node => node.id === "group"
      ? { ...node, data: { kind: "group" as const, title: "新组名", collapsed: false } }
      : node.id === "image" ? { ...node, parentId: "group" } : node);
    const result = listCanvasMaterialRows(changed, listCanvasCurrentMaterials(changed));
    expect(result[0]).toMatchObject({ name: "新组名" });
    expect(result.find(row => row.id === "image")).toMatchObject({ depth: 1 });
    const ungrouped = changed.filter(node => node.id !== "group");
    expect(listCanvasMaterialRows(ungrouped, listCanvasCurrentMaterials(ungrouped)).every(row => row.depth === 0)).toBe(true);
  });
});

describe("current canvas materials", () => {
  it("includes uploaded audio and generated audio through every task state", () => {
    const states = ["idle", "submitting", "running", "success", "failed", "cancelled"] as const;
    const nodes: CanvasNode[] = [
      { id: "upload", type: "audio", position: { x: 0, y: 0 }, data: { kind: "audio", url: "/voice.mp3", name: "上传配音" } },
      ...states.map(status => ({
        id: status, type: "audioTask" as const, position: { x: 0, y: 0 },
        data: { kind: "audioTask" as const, model: "speech", prompt: "配音", voiceId: "voice", speed: 1, pitch: 0, volume: 1,
          modifyPitch: 0, modifyIntensity: 0, modifyTimbre: 0, soundEffect: "" as const, status,
          outputUrl: "/generated.mp3", outputName: "音频节点2" },
      })),
    ];
    const items = listCanvasCurrentMaterials(nodes);
    expect(items.map(item => item.nodeId)).toEqual(["upload", ...states]);
    expect(items.every(item => item.kind === "audio")).toBe(true);
    expect(items.find(item => item.nodeId === "success")).toMatchObject({ name: "音频节点2", url: "/generated.mp3" });
    for (const status of states.filter(status => status !== "success")) {
      expect(items.find(item => item.nodeId === status)).toMatchObject({ temporary: true, url: "", thumbnailUrl: "" });
    }
    expect(listCanvasMaterialRows(nodes, items, { kind: "audio" })).toHaveLength(7);
  });

  it("includes written and generated text, including empty nodes, in groups and text filtering", () => {
    const nodes: CanvasNode[] = [
      { id: "g", type: "group", position: { x: 0, y: 0 }, data: { kind: "group", title: "脚本", collapsed: true } },
      { id: "p", parentId: "g", type: "prompt", position: { x: 0, y: 0 }, data: { kind: "prompt", text: "正文", title: "开场文案" } },
      { id: "empty", type: "prompt", position: { x: 0, y: 0 }, data: { kind: "prompt", text: "" } },
      { id: "llm", parentId: "g", type: "llm", position: { x: 0, y: 0 }, data: { kind: "llm", prompt: "", status: "idle" } },
      { id: "result", type: "llm", position: { x: 0, y: 0 }, data: { kind: "llm", prompt: "请写文案", status: "success", output: "生成文案" } },
    ];
    const items = listCanvasCurrentMaterials(nodes);
    expect(items.map(item => [item.nodeId, item.kind, item.name])).toEqual([
      ["p", "text", "开场文案"], ["empty", "text", "文本节点 2"], ["llm", "text", "文本节点 3"], ["result", "text", "文本节点 4"],
    ]);
    expect(items.every(item => item.url === "" && item.thumbnailUrl === "")).toBe(true);
    expect(listCanvasMaterialRows(nodes, items, { kind: "text", collapsed: new Set(["g"]) }).map(row => [row.id, row.depth])).toEqual([
      ["group:g", 0], ["p", 1], ["llm", 1], ["empty", 0], ["result", 0],
    ]);
    expect(listCanvasMaterialRows(nodes, items, { kind: "text", query: "开场" }).map(row => row.id)).toEqual(["group:g", "p"]);
  });

  it("uses provided thumbnails and video posters while keeping original material URLs", () => {
    const nodes: CanvasNode[] = [
      { id: "image", type: "image", position: { x: 0, y: 0 }, data: { kind: "image", url: "/uploads/original.png", variants: { thumbnail: { url: "/uploads/small.webp" } } } },
      { id: "video", type: "videoTask", position: { x: 0, y: 0 }, data: { kind: "videoTask", model: "model", prompt: "", mediaPaths: [], status: "success", outputUrl: "/uploads/output.mp4", variants: { poster: { url: "/uploads/poster.webp" } } } },
    ];
    expect(listCanvasCurrentMaterials(nodes)).toEqual([
      expect.objectContaining({ url: "/uploads/original.png", thumbnailUrl: "/uploads/small.webp" }),
      expect.objectContaining({ url: "/uploads/output.mp4", thumbnailUrl: "/uploads/poster.webp" }),
    ]);
  });

  it("lists direct image and video nodes in canvas order", () => {
    const nodes: CanvasNode[] = [
      {
        id: "image-1",
        type: "image",
        position: { x: 0, y: 0 },
        data: { kind: "image", url: "/uploads/canvas/chair.png", name: "chair.png" },
      },
      {
        id: "video-1",
        type: "video",
        position: { x: 20, y: 20 },
        data: { kind: "video", url: "/uploads/canvas/demo.mp4", posterUrl: "/uploads/canvas/demo.jpg" },
      },
    ];

    expect(listCanvasCurrentMaterials(nodes)).toEqual([
      {
        id: "image-1",
        nodeId: "image-1",
        kind: "image",
        url: "/uploads/canvas/chair.png",
        thumbnailUrl: "/uploads/canvas/chair.png",
        name: "chair.png",
      },
      {
        id: "video-1",
        nodeId: "video-1",
        kind: "video",
        url: "/uploads/canvas/demo.mp4",
        thumbnailUrl: "/uploads/canvas/demo.jpg",
        name: "视频 1",
      },
    ]);
  });

  it("lists only successful outputs from the latest image generation batch", () => {
    const nodes: CanvasNode[] = [
      {
        id: "image-task",
        type: "imageTask",
        position: { x: 0, y: 0 },
        data: {
          kind: "imageTask",
          task: {
            references: [],
            settings: { model: "model", prompt: "prompt", aspectRatio: "1:1", resolution: "2K", quality: "", count: 2 },
            batches: [
              {
                id: "batch-1",
                createdAt: 1,
                settings: { model: "model", prompt: "prompt", aspectRatio: "1:1", resolution: "2K", quality: "", count: 2 },
                outputs: [
                  { id: "output-1", status: "success", url: "/uploads/canvas_image_results/one.png" },
                  { id: "output-2", status: "failed", url: "/uploads/canvas_image_results/failed.png" },
                ],
              },
              {
                id: "batch-2",
                createdAt: 2,
                settings: { model: "model", prompt: "prompt", aspectRatio: "1:1", resolution: "2K", quality: "", count: 1 },
                outputs: [{ id: "output-3", status: "success", url: "/uploads/canvas_image_results/two.png" }],
              },
            ],
          },
        },
      },
      {
        id: "video-running",
        type: "videoTask",
        position: { x: 0, y: 0 },
        data: { kind: "videoTask", model: "model", prompt: "", mediaPaths: [], status: "running", outputUrl: "/uploads/canvas_video_results/running.mp4" },
      },
      {
        id: "video-task",
        type: "videoTask",
        position: { x: 0, y: 0 },
        data: { kind: "videoTask", model: "model", prompt: "", mediaPaths: [], status: "success", outputUrl: "/uploads/canvas_video_results/done.mp4" },
      },
    ];

    expect(listCanvasCurrentMaterials(nodes)).toEqual([
      expect.objectContaining({ id: "image-task:batch-2:output-3", nodeId: "image-task", kind: "image", name: "图片结果 1" }),
      expect.objectContaining({ id: "video-running:temp", nodeId: "video-running", kind: "video", name: "临时（__temp）", temporary: true }),
      expect.objectContaining({ id: "video-task:output", nodeId: "video-task", kind: "video", name: "视频结果 1" }),
    ]);
  });

  it("keeps duplicate URLs when they belong to different nodes", () => {
    const nodes: CanvasNode[] = ["first", "second"].map((id) => ({
      id,
      type: "image",
      position: { x: 0, y: 0 },
      data: { kind: "image", url: "/uploads/canvas/shared.png" },
    }));

    expect(listCanvasCurrentMaterials(nodes).map((item) => item.nodeId)).toEqual(["first", "second"]);
  });

  it("lists live temporary materials as soon as image and video task panels exist", () => {
    const nodes: CanvasNode[] = [
      {
        id: "image-task-empty",
        type: "imageTask",
        position: { x: 0, y: 0 },
        data: {
          kind: "imageTask",
          task: {
            references: [],
            settings: { model: "model", prompt: "", aspectRatio: "1:1", resolution: "2K", quality: "", count: 1 },
            batches: [],
          },
        },
      },
      {
        id: "video-task-empty",
        type: "videoTask",
        position: { x: 20, y: 20 },
        data: { kind: "videoTask", model: "model", prompt: "", mediaPaths: [], status: "idle" },
      },
    ];

    expect(listCanvasCurrentMaterials(nodes)).toEqual([
      {
        id: "image-task-empty:temp",
        nodeId: "image-task-empty",
        kind: "image",
        url: "",
        thumbnailUrl: "",
        name: "临时（__temp）",
        temporary: true,
      },
      {
        id: "video-task-empty:temp",
        nodeId: "video-task-empty",
        kind: "video",
        url: "",
        thumbnailUrl: "",
        name: "临时（__temp）",
        temporary: true,
      },
    ]);
  });
});
