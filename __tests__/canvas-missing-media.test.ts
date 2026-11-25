import path from "node:path";
import { readFileSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CanvasDocumentV2 } from "@/lib/canvas/document";
import { removeCanvasMissingMediaNodes } from "@/lib/canvas/missing-media";
import { deletedUploadUrlFromPath, subscribeCanvasUploadDeletion } from "@/lib/canvas/local-media-events";

const watcherCleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of watcherCleanups.splice(0)) cleanup();
  vi.unstubAllEnvs();
});

function createDocument(): CanvasDocumentV2 {
  return {
    schemaVersion: 2,
    mode: "smart",
    nodes: [
      {
        id: "deleted-image",
        type: "image",
        position: { x: 20, y: 30 },
        data: { kind: "image", url: "/uploads/canvas_imports/demo_20260724/chair.png", name: "chair.png" },
      },
      {
        id: "prompt",
        type: "prompt",
        position: { x: 400, y: 30 },
        data: { kind: "prompt", text: "keep this node" },
      },
      {
        id: "other-image",
        type: "image",
        position: { x: 20, y: 360 },
        data: { kind: "image", url: "/uploads/canvas_imports/demo_20260724/keep.png", name: "keep.png" },
      },
    ],
    edges: [
      { id: "deleted-edge", source: "deleted-image", target: "prompt", type: "default" },
      { id: "keep-edge", source: "other-image", target: "prompt", type: "default" },
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
    settings: { snapToGrid: false, gridSize: 24 },
  };
}

describe("canvas missing local media", () => {
  it("removes a deleted upload node and its incident edges while preserving other nodes", () => {
    const document = createDocument();

    const next = removeCanvasMissingMediaNodes(document, ["/uploads/canvas_imports/demo_20260724/chair.png"]);

    expect(next.nodes.map((node) => node.id)).toEqual(["prompt", "other-image"]);
    expect(next.edges.map((edge) => edge.id)).toEqual(["keep-edge"]);
  });

  it("matches the deleted upload URL when the canvas reference has a host and cache query", () => {
    const document = createDocument();
    document.nodes[0] = {
      ...document.nodes[0],
      data: { kind: "image", url: "http://localhost:3100/uploads/canvas_imports/demo_20260724/chair.png?revision=1" },
    };

    const next = removeCanvasMissingMediaNodes(document, ["/uploads/canvas_imports/demo_20260724/chair.png"]);

    expect(next.nodes.some((node) => node.id === "deleted-image")).toBe(false);
  });

  it("turns only an upload-root deletion path into a browser-safe URL", () => {
    const uploadsRoot = path.join(path.parse(process.cwd()).root, "ai-tools", "uploads");
    const diskPath = path.join(uploadsRoot, "canvas_imports", "demo_20260724", "chair.png");

    expect(deletedUploadUrlFromPath(uploadsRoot, diskPath)).toBe("/uploads/canvas_imports/demo_20260724/chair.png");
    expect(deletedUploadUrlFromPath(uploadsRoot, path.join(path.parse(process.cwd()).root, "outside", "chair.png"))).toBeNull();
  });

  it("emits the deleted local upload URL without polling", async () => {
    const uploadsRoot = await fs.mkdtemp(path.join(os.tmpdir(), "canvas-media-events-"));
    const relative = path.join("canvas_imports", "demo_20260724", "chair.png");
    const deletedFile = path.join(uploadsRoot, relative);
    vi.stubEnv("UPLOADS_DIR", uploadsRoot);
    await fs.mkdir(path.dirname(deletedFile), { recursive: true });
    await fs.writeFile(deletedFile, "deleted");

    try {
      const received = new Promise<string>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("file deletion event timed out")), 3_000);
        const unsubscribe = subscribeCanvasUploadDeletion((url) => {
          if (url !== "/uploads/canvas_imports/demo_20260724/chair.png") return;
          clearTimeout(timeout);
          unsubscribe();
          resolve(url);
        });
        watcherCleanups.push(unsubscribe);
      });
      await fs.rm(deletedFile);
      await expect(received).resolves.toBe("/uploads/canvas_imports/demo_20260724/chair.png");
    } finally {
      await fs.rm(uploadsRoot, { recursive: true, force: true });
    }
  });

  it("watches storage only while a canvas stream is connected and removes matching nodes immediately", () => {
    const events = readFileSync("lib/canvas/local-media-events.ts", "utf8");
    const route = readFileSync("app/api/canvas/media/events/route.ts", "utf8");
    const page = readFileSync("components/canvas/CanvasEditorPage.tsx", "utf8");

    expect(events).toContain("fs.watch");
    expect(events).toContain("watcher?.close()");
    expect(route).toContain("subscribeCanvasUploadDeletion");
    expect(route).toContain('"text/event-stream; charset=utf-8"');
    expect(route).toContain('send("media-deleted", { url })');
    expect(route).toContain('path: ["data", "url"]');
    expect(page).toContain("new EventSource(`/api/canvas/media/events?canvasId=${canvasId}`)");
    expect(page).toContain("removeCanvasMissingMediaNodes");
  });
});
