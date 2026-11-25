import { beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ user: vi.fn(), admin: vi.fn(), canvas: vi.fn(), run: vi.fn(), storage: vi.fn(), index: vi.fn(), batch: vi.fn(), details: vi.fn() }));
vi.mock("@/lib/admin-auth", () => ({ isAdminRequest: mock.admin }));
vi.mock("@/lib/creative-agent/access", () => ({ requireCreativeAgentUser: mock.user, requireCreativeAgentCanvas: mock.canvas }));
vi.mock("@/lib/creative-agent/store", () => ({ creativeAgentStore: { getRun: mock.run } }));
vi.mock("@/lib/creative-agent/debug-store", () => ({ requireDebugStorage: mock.storage, readDebugIndex: mock.index, readDebugBatch: mock.batch, readDebugDetails: mock.details }));
import { GET as runRoute } from "@/app/api/creative-agent/runs/[id]/debug/route";
import { GET as indexRoute } from "@/app/api/creative-agent/canvases/[id]/debug/route";
import { GET as streamRoute } from "@/app/api/creative-agent/runs/[id]/debug/stream/route";
import { CreativeAgentError } from "@/lib/creative-agent/errors";
beforeEach(() => {
  vi.resetAllMocks(); mock.user.mockResolvedValue(7); mock.admin.mockReturnValue(true); mock.canvas.mockResolvedValue({});
  mock.run.mockResolvedValue({ id: "r", canvasId: 2, actorUserId: 7, status: "running" }); mock.storage.mockResolvedValue(undefined);
  mock.details.mockResolvedValue({ items: [], nextSequence: 0, hasMore: false }); mock.index.mockResolvedValue({ sessions: [], runs: [] });
  mock.batch.mockResolvedValue({ events: [], nextSequence: 9, nextPublicSequence: 12, hasMore: false, run: { id: "r", status: "running" } });
});
describe("Agent private debug routes", () => {
  it("denies normal users even when they own the run, including direct detail and stream requests", async () => {
    mock.admin.mockReturnValue(false);
    for (const route of [runRoute, streamRoute]) expect((await route(new Request("http://localhost/api?details=1"), { params: { id: "r" } })).status).toBe(403);
    expect((await indexRoute(new Request("http://localhost/api"), { params: { id: "2" } })).status).toBe(403);
    expect(mock.run).not.toHaveBeenCalled(); expect(mock.details).not.toHaveBeenCalled(); expect(mock.batch).not.toHaveBeenCalled();
  });
  it("binds admin detail reads to the authenticated run owner and rechecks canvas access", async () => {
    const response = await runRoute(new Request("http://localhost/api?details=1&spanId=model%3A1&after=3"), { params: { id: "r" } });
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mock.run).toHaveBeenCalledWith("r", 7); expect(mock.canvas).toHaveBeenCalledWith(7, 2); expect(mock.details).toHaveBeenCalledWith("r", "model:1", 3);
    mock.canvas.mockRejectedValue(new CreativeAgentError("CANVAS_NOT_FOUND", "revoked", 404)); mock.details.mockClear();
    expect((await runRoute(new Request("http://localhost/api?details=1"), { params: { id: "r" } })).status).toBe(404); expect(mock.details).not.toHaveBeenCalled();
  });
  it("streams only after authorization and resumes both cursors without requesting payload details", async () => {
    const abort = new AbortController();
    const response = await streamRoute(new Request("http://localhost/api?after=9&publicAfter=12", { signal: abort.signal }), { params: { id: "r" } });
    const reader = response.body!.getReader(); const chunk = await reader.read();
    expect(new TextDecoder().decode(chunk.value)).toContain('"nextSequence":9');
    expect(mock.batch).toHaveBeenCalledWith(expect.objectContaining({ id: "r" }), 9, 12);
    expect(mock.details).not.toHaveBeenCalled(); expect(mock.admin.mock.calls.length).toBeGreaterThanOrEqual(2);
    abort.abort(); await reader.cancel();
  });
  it("rejects invalid cursors before querying trace contents", async () => {
    expect((await runRoute(new Request("http://localhost/api?after=-1"), { params: { id: "r" } })).status).toBe(400);
    expect(mock.batch).not.toHaveBeenCalled();
  });
});
