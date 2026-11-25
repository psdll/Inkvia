import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: vi.fn(), enabled: vi.fn(), canvasEnabled: vi.fn(), canvas: vi.fn(), admission: vi.fn(),
  findSubmission: vi.fn(), enqueue: vi.fn(), reviseMessage: vi.fn(), snapshot: vi.fn(), getRun: vi.fn(), events: vi.fn(), control: vi.fn(),
  resolveAttachments: vi.fn(), readAttachments: vi.fn(), readCanvas: vi.fn(), selection: vi.fn(), capabilities: vi.fn(),
}));
vi.mock("@/lib/server-auth", () => ({ getUserId: mocks.user }));
vi.mock("@/lib/prisma", () => ({ default: { canvas: { findFirst: mocks.canvas } } }));
vi.mock("@/lib/maintenance", () => ({ assertDurableWorkAdmission: mocks.admission, MaintenanceSubmissionError: class extends Error {} }));
vi.mock("@/lib/creative-agent/store", () => ({ creativeAgentStore: mocks }));
vi.mock("@/lib/creative-agent/config", () => ({ getCreativeAgentCapabilities: mocks.capabilities }));
vi.mock("@/lib/creative-agent/canvas-tools", () => ({ readCreativeAgentCanvas: mocks.readCanvas, resolveCreativeAgentSelection: mocks.selection }));
vi.mock("@/lib/creative-agent/model-catalog", () => ({ validateCreativeAgentOptions: async () => ({ providerId: "test", modelId: "test" }), creativeAgentSupportsVision: () => true }));
vi.mock("@/lib/creative-agent/attachments", () => ({ resolveCreativeAgentAttachments: mocks.resolveAttachments, readCreativeAgentAttachments: mocks.readAttachments }));
import { PATCH, POST } from "@/app/api/creative-agent/canvases/[id]/messages/route";
import { GET as events } from "@/app/api/creative-agent/runs/[id]/events/route";
import { GET as stream } from "@/app/api/creative-agent/runs/[id]/stream/route";

const input = { messageId: "a508c17a-2fdf-4f22-b48d-92e2d458e194", text: "只改结尾", baseRevision: "3", selection: { nodeIds: [], edgeIds: [], references: [] } };
const request = (body: unknown = input, origin = "http://localhost:3311") => new Request("http://localhost:3311/api/creative-agent/canvases/2/messages", { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(body) });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.user.mockResolvedValue(7); mocks.enabled.mockResolvedValue(true); mocks.canvasEnabled.mockResolvedValue(true);
  mocks.canvas.mockResolvedValue({ authUserId: 7, revision64: BigInt(3), members: [] }); mocks.admission.mockResolvedValue(undefined);
  mocks.resolveAttachments.mockResolvedValue([]); mocks.readAttachments.mockResolvedValue([]);
  mocks.findSubmission.mockResolvedValue(null); mocks.capabilities.mockResolvedValue({ enabled: true, ready: true });
  mocks.readCanvas.mockResolvedValue({ revision: "3", nodes: [], edgeIds: [] }); mocks.selection.mockReturnValue(input.selection);
  mocks.enqueue.mockResolvedValue({ sessionId: "session", run: { id: "run" } });
});
describe("creative Agent request boundaries", () => {
  it("authorizes in-place revisions and returns the same conversation snapshot", async () => {
    const edit = { runId: "r", messageId: "m", requestId: input.messageId, text: "新要求", expectedText: "旧要求" };
    const make = (body: unknown, origin = "http://localhost:3311") => new Request("http://localhost:3311/api/creative-agent/canvases/2/messages", { method: "PATCH", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    mocks.reviseMessage.mockResolvedValue({ sessionId: "same-session", runId: "r" });
    mocks.snapshot.mockResolvedValue({ sessionId: "same-session", messages: [{ id: "m", text: "新要求" }] });
    expect((await PATCH(make(edit, "https://elsewhere.invalid"), { params: { id: "2" } })).status).toBe(403);
    expect(mocks.reviseMessage).not.toHaveBeenCalled();
    expect((await PATCH(make({ ...edit, text: "  " }), { params: { id: "2" } })).status).toBe(400);
    const response = await PATCH(make(edit), { params: { id: "2" } });
    expect(response.status).toBe(200);
    expect(mocks.reviseMessage).toHaveBeenCalledWith(7, 2, edit);
    expect(mocks.snapshot).toHaveBeenCalledWith(7, 2, "same-session");
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });
  it("acknowledges a drained terminal stream while continuing to deliver pending media", async () => {
    vi.useFakeTimers();
    const abort = new AbortController();
    try {
      const run = { id: "run", canvasId: 2, status: "failed" };
      const pending = { run, events: [], nextSequence: 5, media: [], mediaPending: true };
      mocks.getRun.mockResolvedValue(run);
      mocks.events.mockResolvedValueOnce({ ...pending, events: [{ runId: "run", sequence: 5, type: "run.failed" }] })
        .mockResolvedValueOnce(pending)
        .mockResolvedValue({ ...pending, media: [{ generationId: 42, status: "success" }], mediaPending: false });
      const response = await stream(new Request("http://localhost:3311/api?after=4", { signal: abort.signal }), { params: { id: "run" } });
      const reader = response.body!.getReader();
      expect(new TextDecoder().decode((await reader.read()).value)).toContain('"sequence":5');
      let acknowledgement = "";
      const next = reader.read().then(chunk => { acknowledgement = new TextDecoder().decode(chunk.value); });
      await vi.advanceTimersByTimeAsync(1200);
      expect(acknowledgement).toContain('"events":[]');
      expect(acknowledgement).toContain('"mediaPending":true');
      await next;
      await vi.advanceTimersByTimeAsync(1200);
      expect(new TextDecoder().decode((await reader.read()).value)).toContain('"generationId":42');
      expect(new TextDecoder().decode((await reader.read()).value)).toContain("event: complete");
    } finally {
      abort.abort();
      vi.useRealTimers();
    }
  });
  it("pushes editing closure even when status and event cursor have not changed", async () => {
    vi.useFakeTimers();
    const abort = new AbortController();
    try {
      const run = { id: "run", canvasId: 2, status: "running" };
      const batch = { run, events: [], nextSequence: 3, media: [], mediaPending: false };
      mocks.getRun.mockResolvedValue(run);
      mocks.events.mockResolvedValueOnce({ ...batch, editableMessageId: "latest" })
        .mockResolvedValue({ ...batch, editableMessageId: null });
      const response = await stream(new Request("http://localhost:3311/api?after=3", { signal: abort.signal }), { params: { id: "run" } });
      const reader = response.body!.getReader();
      expect(new TextDecoder().decode((await reader.read()).value)).toContain('"editableMessageId":"latest"');
      const next = reader.read();
      await vi.advanceTimersByTimeAsync(1200);
      expect(new TextDecoder().decode((await next).value)).toContain('"editableMessageId":null');
      await reader.cancel();
    } finally {
      abort.abort();
      vi.useRealTimers();
    }
  });
  it("rejects cross-origin or unauthenticated writes without creating a run", async () => {
    expect((await POST(request(input, "https://elsewhere.invalid"), { params: { id: "2" } })).status).toBe(403);
    mocks.user.mockResolvedValue(null);
    expect((await POST(request(), { params: { id: "2" } })).status).toBe(401);
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });
  it("is always on and respects read-only membership", async () => {
    mocks.canvas.mockResolvedValue({ authUserId: 99, revision64: BigInt(3), members: [{ role: "VIEWER" }] });
    expect((await POST(request(), { params: { id: "2" } })).status).toBe(404);
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });
  it("recovers an identical submission before checking a now-advanced canvas or unavailable worker", async () => {
    mocks.findSubmission.mockResolvedValue({ sessionId: "session", run: { id: "run" } });
    mocks.readCanvas.mockResolvedValue({ revision: "100" }); mocks.capabilities.mockResolvedValue({ ready: false });
    const response = await POST(request(), { params: { id: "2" } });
    expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ runId: "run" });
    expect(mocks.readCanvas).not.toHaveBeenCalled(); expect(mocks.enqueue).not.toHaveBeenCalled();
  });
  it("rejects an unsaved revision and passes only server-resolved refs for a fresh run", async () => {
    mocks.readCanvas.mockResolvedValueOnce({ revision: "4" });
    expect((await POST(request(), { params: { id: "2" } })).status).toBe(409);
    expect(mocks.enqueue).not.toHaveBeenCalled();
    expect((await POST(request(), { params: { id: "2" } })).status).toBe(200);
    expect(mocks.enqueue).toHaveBeenCalledWith(expect.objectContaining({ actorUserId: 7, canvasId: 2, resolvedSelection: input.selection }));
    expect(mocks.resolveAttachments).toHaveBeenCalledTimes(2);
    expect(mocks.readAttachments).not.toHaveBeenCalled();
  });
  it("rechecks current canvas access before revealing run events", async () => {
    mocks.getRun.mockResolvedValue({ id: "run", canvasId: 2 }); mocks.canvas.mockResolvedValue(null);
    const response = await events(new Request("http://localhost:3311/api/creative-agent/runs/run/events?after=2"), { params: { id: "run" } });
    expect(response.status).toBe(404); expect(mocks.events).not.toHaveBeenCalled();
  });
});
