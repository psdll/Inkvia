import { describe, expect, it } from "vitest";
import { createEmptyCanvasDocumentV2, type CanvasNode } from "@/lib/canvas/document";
import { buildCreativeAgentMediaTask } from "@/lib/creative-agent/media-task";
import { restoreCreativeAgentMediaTasks } from "@/lib/creative-agent/restore-media-tasks";

const mediaId = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const task = buildCreativeAgentMediaTask({ id: 12, type: "image_edit", model: "nano-banana-pro", prompt: "原始提示词", templateData: '{"aspectRatio":"3:4","resolution":"2K"}' }, { mediaId, url: "/uploads/result.png" });
const node: CanvasNode = { id: "existing", type: "image", position: { x: 13, y: 24 }, width: 350, height: 467, parentId: "group",
 data: { kind: "image", name: "我重命名的图片", origin: "generated", mediaId, url: "/uploads/result.png", variants: { original: { url: "/uploads/result.png", width: 1728, height: 2304 } } } };
const recovery = { nodeId: node.id, mediaId, url: "/uploads/result.png", generationCanvasId: 8, generationTask: task };
describe("Agent result task nodes", () => {
 it("restores a renamed result while preserving its identity, layout, dimensions and edges", () => {
  const document = { ...createEmptyCanvasDocumentV2(), nodes: [node] };
  const next = restoreCreativeAgentMediaTasks(document, 8, [recovery]);
  expect(next.nodes[0]).toMatchObject({ id: node.id, position: node.position, width: node.width, height: node.height, parentId: node.parentId, type: "imageTask", data: { kind: "imageTask", title: "我重命名的图片" } });
  expect(next.nodes[0].data).toMatchObject({ task: { settings: { prompt: "原始提示词" }, batches: [{ outputs: [{ mediaId, generationId: 12, width: 1728, height: 2304 }] }] } });
  expect(next.edges).toBe(document.edges);
  expect(restoreCreativeAgentMediaTasks(next, 8, [recovery])).toBe(next);
 });
 it("does not resurrect a deleted result or overwrite a replaced or foreign result", () => {
  for (const nodes of [[], [{ ...node, data: { ...node.data, url: "/uploads/replaced.png" } } as CanvasNode]]) {
   const document = { ...createEmptyCanvasDocumentV2(), nodes };
   expect(restoreCreativeAgentMediaTasks(document, 8, [recovery])).toBe(document);
  }
  const document = { ...createEmptyCanvasDocumentV2(), nodes: [node] };
  expect(restoreCreativeAgentMediaTasks(document, 9, [recovery])).toBe(document);
 });
 it("preserves video generation settings and ordered inputs in the existing video task", () => {
  const data = buildCreativeAgentMediaTask({ id: 13, type: "video_gen", model: "seedance", prompt: "运镜", templateData: JSON.stringify({ inputMode: "first_last_frame", imagePaths: ["/uploads/start.png", "/uploads/end.png"], ratio: "9:16", resolution: "1080p", duration: 5, generateAudio: true, cameraFixed: false, watermark: false }) }, { mediaId, url: "/uploads/result.mp4", width: 1080, height: 1920 });
  expect(data).toMatchObject({ kind: "videoTask", model: "seedance", prompt: "运镜", mediaPaths: ["/uploads/start.png", "/uploads/end.png"], inputMode: "first_last_frame", ratio: "9:16", resolution: "1080p", duration: 5, generateAudio: true, cameraFixed: false, watermark: false, status: "success", generationId: 13, mediaId, outputUrl: "/uploads/result.mp4" });
 });
});
