import { describe, expect, it } from "vitest";
import { createEmptyCanvasDocumentV2, type CanvasDocumentV2, type CanvasNode } from "@/lib/canvas/document";
import { createCanvasHistory, pushCanvasHistory, replaceCanvasHistoryPresent, undoCanvasHistory, redoCanvasHistory } from "@/lib/canvas/history";
import { preserveCanvasTaskExecutions } from "@/lib/canvas/task-history";

const video = (status: "idle" | "submitting" | "running" | "success" | "cancelled", extra = {}): CanvasNode => ({
  id: "video", type: "videoTask", position: { x: 10, y: 20 },
  data: { kind: "videoTask", model: "minimax-h3", prompt: "submitted prompt", mediaPaths: [], status, ...extra },
});
const doc = (...nodes: CanvasNode[]): CanvasDocumentV2 => ({ ...createEmptyCanvasDocumentV2(), nodes });

describe("canvas task execution across undo and redo", () => {
  it.each(["submitting", "running"] as const)("keeps a %s task when undo crosses creation, while undoing unrelated edits", status => {
    const idle = video("idle");
    const active = video(status, { requestKey: "same-request", generationId: status === "running" ? 32594 : undefined, startedAt: 123 });
    const prompt: CanvasNode = { id: "prompt", type: "prompt", position: { x: 0, y: 0 }, data: { kind: "prompt", text: "before" } };
    let history = pushCanvasHistory(createCanvasHistory(doc(prompt)), doc(prompt, idle));
    history = replaceCanvasHistoryPresent(history, doc(prompt, active));
    history = pushCanvasHistory(history, doc({ ...prompt, data: { kind: "prompt", text: "after" } }, active));
    history = undoCanvasHistory(history);
    expect(history.present.nodes.find(node => node.id === "prompt")?.data).toEqual(prompt.data);
    history = undoCanvasHistory(history);
    expect(history.present.nodes.find(node => node.id === "video")?.data).toEqual(active.data);
    history = redoCanvasHistory(history);
    expect(history.present.nodes.find(node => node.id === "video")?.data).toEqual(active.data);
  });

  it("retains a running task's parent groups and valid incoming links", () => {
    const group: CanvasNode = { id: "group", type: "group", position: { x: 100, y: 200 }, data: { kind: "group", title: "group", collapsed: false } };
    const source: CanvasNode = { id: "source", type: "image", position: { x: 0, y: 0 }, data: { kind: "image", url: "/ref.png" } };
    const active = { ...video("running", { generationId: 32594 }), parentId: "group", extent: "parent" as const };
    const current = { ...doc(group, source, active), edges: [{ id: "reference", source: "source", target: "video" }] };
    const restored = preserveCanvasTaskExecutions(doc(source), current);
    expect(restored.nodes.map(node => node.id)).toEqual(["source", "group", "video"]);
    expect(restored.nodes.find(node => node.id === "video")).toEqual(active);
    expect(restored.edges).toEqual(current.edges);
  });

  it("never rolls completion or cancellation back to an older running request", () => {
    const old = video("running", { requestKey: "old", generationId: 1, error: "stale" });
    for (const status of ["success", "cancelled"] as const) {
      const latest = video(status, { requestKey: "new", generationId: 2, outputUrl: status === "success" ? "/result.mp4" : undefined, finishedAt: 456 });
      let history = pushCanvasHistory(createCanvasHistory(doc(old)), doc(latest));
      history = undoCanvasHistory(history);
      expect(history.present.nodes[0].data).toEqual(latest.data);
      expect(redoCanvasHistory(history).present.nodes[0].data).toEqual(latest.data);
    }
  });

  it("keeps live image batches when undo targets a snapshot before submission", () => {
    const settings = { model: "gpt-image-2", prompt: "image", aspectRatio: "1:1", resolution: "1K", quality: "auto", count: 2 };
    const idle: CanvasNode = { id: "image-task", type: "imageTask", position: { x: 0, y: 0 }, data: { kind: "imageTask", task: { references: [], settings, batches: [] } } };
    const running: CanvasNode = { ...idle, data: { kind: "imageTask", task: { references: [], settings, batches: [{ id: "batch", createdAt: 100, settings, outputs: [{ id: "one", status: "success", url: "/one.png", generationId: 1 }, { id: "two", status: "running", generationId: 2, requestKey: "same" }] }] } } };
    const history = replaceCanvasHistoryPresent(pushCanvasHistory(createCanvasHistory(doc()), doc(idle)), doc(running));
    expect(undoCanvasHistory(history).present.nodes[0]).toEqual(running);
    const completed: CanvasNode = { ...running, data: { kind: "imageTask", task: { references: [], settings, batches: [] } } };
    // Removing a batch explicitly must not resurrect its old running outputs.
    expect(preserveCanvasTaskExecutions(doc(running), doc(completed)).nodes[0].data).toEqual(completed.data);
  });

  it.each(["audioTask", "llm"] as const)("keeps %s runtime state outside edit history", kind => {
    const active = { ...video("running"), type: kind, data: { kind, status: "running", prompt: "submitted", generationId: 3 } } as CanvasNode;
    const snapshot = { ...active, data: { ...active.data, status: "idle", prompt: "older" } } as CanvasNode;
    expect(preserveCanvasTaskExecutions(doc(snapshot), doc(active)).nodes[0].data).toEqual(active.data);
    expect(preserveCanvasTaskExecutions(doc(), doc(active)).nodes[0]).toEqual(active);
  });
});
