import { beforeEach, describe, expect, it, vi } from "vitest";
import { createEmptyCanvasDocumentV2 } from "@/lib/canvas/document";

const mocks = vi.hoisted(() => ({
  getUserId: vi.fn(),
  requireCanvasEntryEnabled: vi.fn(),
  addFolder: vi.fn(),
  addBuffer: vi.fn(),
}));

vi.mock("@/lib/server-auth", () => ({ getUserId: mocks.getUserId }));
vi.mock("@/lib/canvas/library", () => ({ addFolder: mocks.addFolder, addBuffer: mocks.addBuffer }));

function request(body: unknown) {
  return new Request("http://localhost/api/canvas/library/workflows", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as any;
}

describe("canvas workflow library API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUserId.mockResolvedValue(9);
    mocks.requireCanvasEntryEnabled.mockResolvedValue(null);
    mocks.addFolder.mockResolvedValue(["default", "workflows"]);
    mocks.addBuffer.mockResolvedValue({ id: "workflow-1", kind: "file", name: "研究.canvas.json" });
  });

  it("validates and stores a workflow in the dedicated workflows folder", async () => {
    const { POST } = await import("@/app/api/canvas/library/workflows/route");
    const response = await POST(request({ title: "研究", document: createEmptyCanvasDocumentV2() }));

    expect(response.status).toBe(200);
    expect(mocks.addFolder).toHaveBeenCalledWith(9, "workflows");
    expect(mocks.addBuffer).toHaveBeenCalledWith(9, expect.any(Buffer), expect.objectContaining({ ext: "canvas.json", folder: "workflows", name: "研究.canvas.json" }));
  });

  it("rejects a non-V2 document before writing a file", async () => {
    const { POST } = await import("@/app/api/canvas/library/workflows/route");
    const response = await POST(request({ title: "坏文件", document: { mode: "node" } }));

    expect(response.status).toBe(400);
    expect(mocks.addBuffer).not.toHaveBeenCalled();
  });
});
