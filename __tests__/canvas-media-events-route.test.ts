import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUserId: vi.fn(),
  findCanvas: vi.fn(),
  countCanvasNodes: vi.fn(),
  countOwnedMedia: vi.fn(),
  subscribe: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    canvas: { findFirst: mocks.findCanvas },
    canvasNodeState: { count: mocks.countCanvasNodes },
    mediaAsset: { count: mocks.countOwnedMedia },
  },
}));
vi.mock("@/lib/server-auth", () => ({ getUserId: mocks.getUserId }));
vi.mock("@/lib/canvas/local-media-events", () => ({ subscribeCanvasUploadDeletion: mocks.subscribe }));

import { GET } from "@/app/api/canvas/media/events/route";

describe("canvas media deletion event stream", () => {
  afterEach(() => vi.resetAllMocks());

  it("sends a deleted media event only after the authenticated canvas is verified", async () => {
    let listener: ((url: string) => void) | undefined;
    const unsubscribe = vi.fn();
    mocks.getUserId.mockResolvedValue(7);
    mocks.findCanvas.mockResolvedValue({ id: 50 });
    mocks.countCanvasNodes.mockResolvedValue(1);
    mocks.countOwnedMedia.mockResolvedValue(0);
    mocks.subscribe.mockImplementation((next: (url: string) => void) => {
      listener = next;
      return unsubscribe;
    });

    const response = await GET({ nextUrl: new URL("http://localhost/api/canvas/media/events?canvasId=50") } as any);

    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(mocks.findCanvas).toHaveBeenCalledWith({
      where: { id: 50, authUserId: 7, deletedAt: null },
      select: { id: true },
    });
    const reader = response.body!.getReader();
    const nextChunk = reader.read();
    listener!("/uploads/canvas_imports/demo_20260724/chair.png");
    const result = await nextChunk;

    expect(new TextDecoder().decode(result.value)).toContain('event: media-deleted\ndata: {"url":"/uploads/canvas_imports/demo_20260724/chair.png"}');
    expect(mocks.countCanvasNodes).toHaveBeenCalledWith({
      where: { canvasId: 50, data: { path: ["data", "url"], equals: "/uploads/canvas_imports/demo_20260724/chair.png" } },
    });
    await reader.cancel();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
