import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import React from "react";
import { renderToStaticMarkup as renderMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import CanvasLibraryPanel from "@/components/canvas/CanvasLibraryPanel";
import type { CanvasNode } from "@/lib/canvas/document";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
const renderToStaticMarkup = (node: React.ReactElement) => renderMarkup(React.createElement(QueryClientProvider, { client: new QueryClient() }, node));
const read = (file: string) => readFileSync(resolve(process.cwd(), file), "utf8");

describe("current canvas materials panel", () => {
  const imageNodes = (count: number): CanvasNode[] => Array.from({ length: count }, (_, i) => ({
    id: `image-${i}`, type: "image", position: { x: 0, y: 0 },
    data: { kind: "image", url: `/uploads/large-${i}.png`, name: `素材 ${i}` },
  }));
  const render = (nodes: CanvasNode[]) => renderToStaticMarkup(React.createElement(CanvasLibraryPanel, { canvasId: 1, ownerId: 27,
    nodes, onLocateNode: vi.fn(), onClose: vi.fn(),
  }));

  it("requests small thumbnails for uploaded images", () => {
    const html = render(imageNodes(2));
    expect(html).toContain('/api/thumb?src=%2Fuploads%2Flarge-0.png&amp;w=120');
    expect(html).not.toContain('src="/uploads/large-0.png"');
    expect(html).toContain('loading="eager"');
    expect(html).toContain('decoding="async"');
  });

  it("does not mount hundreds of offscreen media rows on opening", () => {
    const html = render(imageNodes(1000));
    expect(html.match(/data-canvas-material-node-id=/g)?.length || 0).toBeLessThan(50);
  });

  it("uses the same small-preview path for newly generated images", () => {
    const settings = { model: "model", prompt: "", aspectRatio: "1:1", resolution: "2K", quality: "", count: 1 };
    const html = render([{ id: "generated", type: "imageTask", position: { x: 0, y: 0 }, data: {
      kind: "imageTask", task: { references: [], settings, batches: [{ id: "batch", createdAt: 1, settings,
        outputs: [{ id: "output", status: "success", url: "/uploads/canvas_image_results/new.png" }],
      }] },
    } }]);
    expect(html).toContain('/api/thumb?src=%2Fuploads%2Fcanvas_image_results%2Fnew.png&amp;w=120');
  });

  it("shows video posters without opening the source video", () => {
    const html = render([{ id: "v", type: "video", position: { x: 0, y: 0 },
      data: { kind: "video", url: "/uploads/large.mp4", variants: { poster: { url: "/uploads/poster.jpg" } } } }]);
    expect(html).toContain('%2Fuploads%2Fposter.jpg');
    expect(html).not.toContain('<video');
  });

  it("uses the server thumbnail for a local video without a stored poster", () => {
    const html = render([{ id: "v", type: "video", position: { x: 0, y: 0 }, data: { kind: "video", url: "/uploads/large.mp4" } }]);
    expect(html).toContain('/api/thumb?src=%2Fuploads%2Flarge.mp4&amp;w=120&amp;poster=1');
    expect(html).not.toContain('data-video-poster-preview');
    expect(html).not.toContain('<video');
  });

  it("also shows a server poster for a generated video result", () => {
    const html = render([{ id: "v", type: "videoTask", position: { x: 0, y: 0 }, data: {
      kind: "videoTask", model: "model", prompt: "", mediaPaths: [], status: "success", outputUrl: "/uploads/result.mp4",
    } }]);
    expect(html).toContain('/api/thumb?src=%2Fuploads%2Fresult.mp4&amp;w=120&amp;poster=1');
    expect(html).not.toContain('<video');
  });

  it("keeps non-local videos on the bounded poster loader", () => {
    const html = render([{ id: "v", type: "video", position: { x: 0, y: 0 }, data: { kind: "video", url: "blob:local-upload" } }]);
    expect(html).toContain('data-canvas-material-node-id="v"');
    expect(html).not.toContain('/api/thumb');
    expect(html).not.toContain('<video');
  });

  it("counts all canvas nodes, including groups and non-media nodes", () => {
    const html = render([
      ...imageNodes(2),
      { id: "g", type: "group", position: { x: 0, y: 0 }, data: { kind: "group", title: "组", collapsed: true } },
      { id: "t", type: "prompt", position: { x: 0, y: 0 }, data: { kind: "prompt", text: "说明" } },
    ]);
    expect(html).toContain('共 4 个节点');
    expect(render([])).toContain('共 0 个节点');
  });

  it("shows a newly uploaded local image without transforming its blob URL", () => {
    const nodes = imageNodes(1);
    nodes[0].data = { kind: "image", url: "blob:http://localhost:3100/local-upload" };
    expect(render(nodes)).toContain('src="blob:http://localhost:3100/local-upload"');
  });

  it("renders current-canvas media as compact locatable rows", () => {
    const nodes: CanvasNode[] = [
      {
        id: "image-node",
        type: "image",
        position: { x: 0, y: 0 },
        data: { kind: "image", url: "/uploads/canvas/image.png", name: "按摩椅.png" },
      },
    ];

    const html = renderToStaticMarkup(React.createElement(CanvasLibraryPanel, { canvasId: 1, ownerId: 27,
      nodes,
      onLocateNode: vi.fn(),
      onClose: vi.fn(),
    }));

    expect(html).toContain("当前画布素材");
    expect(html).toContain("全部");
    expect(html).toContain("筛选：全部");
    expect(html).toContain("展示设置");
    expect(html).toContain("按摩椅.png");
    expect(html).toContain('data-canvas-material-node-id="image-node"');
    expect(html).not.toContain('title="上传"');
  });

  it("keeps material tabs and node location without the workflow library tab", () => {
    const panel = read("components/canvas/CanvasLibraryPanel.tsx");

    expect(panel).toContain("listCanvasCurrentMaterials(nodes)");
    expect(panel).toContain("onLocateNode(item.nodeId)");
    const html = render([]);
    expect(html).toContain("当前画布素材");
    expect(html).toContain("素材库");
    expect(html).not.toContain("工作流");
    expect(panel).not.toContain("workflowLibraryOptions");
  });

  it("renders task panels as temporary current-canvas materials before generation", () => {
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

    const html = renderToStaticMarkup(React.createElement(CanvasLibraryPanel, { canvasId: 1, ownerId: 27,
      nodes,
      onLocateNode: vi.fn(),
      onClose: vi.fn(),
    }));

    expect(html).toContain("临时（__temp）");
    expect(html.match(/data-canvas-material-temporary="true"/g) ?? []).toHaveLength(2);
  });

  it("passes live nodes to the panel and focuses the requested canvas node", () => {
    const editor = read("components/canvas/CanvasEditorPage.tsx");
    const board = read("components/canvas/SmartCanvasBoard.tsx");

    expect(editor).toContain("setFocusRequest((current)");
    expect(editor).toContain('const [liveNodes, setLiveNodes] = React.useState<CanvasDocumentV2["nodes"] | null>(null)');
    expect(editor).toContain("onLiveNodesChange={setLiveNodes}");
    expect(editor).toContain("nodes: liveNodes ?? document.nodes");
    expect(editor).toContain("onLocateNode: locateNode");
    expect(editor).toContain("focusRequest={focusRequest}");
    expect(board).toContain('onLiveNodesChange?: (nodes: CanvasDocumentV2["nodes"]) => void;');
    expect(board).toContain("onLiveNodesChange?.(pendingDocumentRef.current.nodes)");
    expect(board).toContain("omitPendingCanvasUploads(");
    expect(board).toContain("focusRequest?: { nodeId: string; requestId: number }");
    expect(board).toContain("flow.getNode(focusRequest.nodeId)");
    expect(board).toContain("setSelectedIds([focusRequest.nodeId])");
    expect(board).toContain("maxZoom: 1.5");
  });
});
