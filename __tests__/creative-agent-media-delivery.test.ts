import { describe, expect, it, vi } from "vitest";
import { creativeToolPresentation } from "@/lib/creative-agent/tool-presentation";
import { applyAgentEvents, emptyAgentState, restoreAgentSnapshot } from "@/components/creative-agent/state";
import { reconcileCreativeAgentMedia } from "@/lib/creative-agent/media-delivery";

const run = { id: "r", sessionId: "s", canvasId: 1, status: "failed" as const, error: "对话中断", createdAt: "2026-10-14", updatedAt: "2026-10-14" };
const media = { generationId: 12, runId: "r", status: "success", mediaType: "image" as const, model: "test-image", nodeIds: ["n"], outputs: [{ url: "/uploads/result.png", width: 1728, height: 2304 }], createdAt: "2026-10-14" };

describe("media delivery is independent of the chat model", () => {
  it("keeps actual outputs in the public presentation, without leaking dispatch details", () => {
    expect(creativeToolPresentation("generation.read", { ...media, mediaDispatch: { secret: "private" } })).toMatchObject({ generationId: 12, outputs: media.outputs, model: "test-image" });
    expect(creativeToolPresentation("generation.read", { ...media, mediaDispatch: { secret: "private" } })).not.toHaveProperty("mediaDispatch");
  });
  it("receives a late successful output even when its conversation has failed", () => {
    const state = applyAgentEvents(emptyAgentState(), [{ sequence: 1, runId: "r", type: "media.updated", payload: media, createdAt: media.createdAt }], run);
    expect(state.media).toEqual([media]);
    expect(state.run?.status).toBe("failed");
    const restored = restoreAgentSnapshot({ sessionId: "s", messages: [], run, latestSequence: 1, media: [media] });
    expect(restored.media).toEqual([media]);
  });
  it("updates one media card instead of adding duplicates during repeated reads", () => {
    const event = { sequence: 2, runId: "r", type: "media.updated" as const, payload: media, createdAt: media.createdAt };
    const state = applyAgentEvents({ ...emptyAgentState(), media: [{ ...media, status: "running", outputs: [] }] }, [event, { ...event, sequence: 3 }], run);
    expect(state.media).toEqual([media]);
  });
  it("reconciles failed and stopped runs using only saved generation IDs", async () => {
    const jobs = [{ run: { ...run, actorUserId: 1, epoch: 3 }, generationId: 12 }, { run: { ...run, id: "stopped", actorUserId: 1, epoch: 4, status: "stopped" }, generationId: 13 }];
    const read = vi.fn(async (_run, id) => ({ ...media, generationId: id }));
    const publish = vi.fn();
    const deps = { pending: vi.fn(async () => jobs), read, publish };
    expect(await reconcileCreativeAgentMedia(deps as never)).toBe(2);
    expect(read.mock.calls.map(call => call[1])).toEqual([12, 13]);
    expect(publish).toHaveBeenCalledTimes(2);
  });
  it("does not block another completed output when one read temporarily fails", async () => {
    const publish = vi.fn();
    const read = vi.fn().mockRejectedValueOnce(new Error("temporary read error")).mockResolvedValueOnce(media);
    const pending = vi.fn(async () => [{ run, generationId: 11 }, { run, generationId: 12 }]);
    expect(await reconcileCreativeAgentMedia({ pending, read, publish } as never)).toBe(1);
    expect(publish).toHaveBeenCalledTimes(1);
  });
});
