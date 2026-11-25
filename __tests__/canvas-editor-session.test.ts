import { describe, expect, it, vi } from "vitest";
import {
  canvasEditorSessionKey,
  claimCanvasEditorSession,
  parseCanvasEditorSessionRecord,
  type CanvasEditorSessionChannel,
} from "@/lib/canvas/editor-session";
import { canvasEditorSessionMatches } from "@/lib/canvas/editor-session-server";

const routeMocks = vi.hoisted(() => ({
  getUserId: vi.fn(),
  canvasFindFirst: vi.fn(),
  appSettingFindUnique: vi.fn(),
  appSettingUpdateMany: vi.fn(),
  appSettingUpsert: vi.fn(),
  appSettingDeleteMany: vi.fn(),
}));

vi.mock("@/lib/server-auth", () => ({ getUserId: routeMocks.getUserId }));
vi.mock("@/lib/prisma", () => ({
  default: {
    canvas: { findFirst: routeMocks.canvasFindFirst },
    appSetting: {
      findUnique: routeMocks.appSettingFindUnique,
      updateMany: routeMocks.appSettingUpdateMany,
      upsert: routeMocks.appSettingUpsert,
      deleteMany: routeMocks.appSettingDeleteMany,
    },
  },
}));

class FakeChannelNetwork {
  private readonly channels = new Map<string, Set<FakeChannel>>();

  create = (name: string): CanvasEditorSessionChannel => {
    const channel = new FakeChannel(name, this);
    const group = this.channels.get(name) ?? new Set<FakeChannel>();
    group.add(channel);
    this.channels.set(name, group);
    return channel;
  };

  broadcast(source: FakeChannel, data: unknown) {
    for (const channel of this.channels.get(source.name) ?? []) {
      if (channel !== source) channel.dispatch(data);
    }
  }

  close(channel: FakeChannel) {
    this.channels.get(channel.name)?.delete(channel);
  }
}

class FakeChannel implements CanvasEditorSessionChannel {
  private readonly listeners = new Set<(event: MessageEvent) => void>();

  constructor(readonly name: string, private readonly network: FakeChannelNetwork) {}
  postMessage(data: unknown) { this.network.broadcast(this, data); }
  addEventListener(_type: "message", listener: (event: MessageEvent) => void) { this.listeners.add(listener); }
  removeEventListener(_type: "message", listener: (event: MessageEvent) => void) { this.listeners.delete(listener); }
  dispatch(data: unknown) { for (const listener of this.listeners) listener({ data } as MessageEvent); }
  close() { this.network.close(this); }
}

function ok(payload: Record<string, unknown> = {}) {
  return new Response(JSON.stringify({ success: true, ...payload }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("canvas editor exclusive session", () => {
  it("scopes the server record by user and canvas and rejects malformed records", () => {
    expect(canvasEditorSessionKey(7, 55)).toBe("canvas.editor-session:7:55");
    expect(parseCanvasEditorSessionRecord(JSON.stringify({ sessionId: "s-1", expiresAt: "2026-09-01T12:00:00.000Z" })))
      .toEqual({ sessionId: "s-1", expiresAt: "2026-09-01T12:00:00.000Z" });
    expect(parseCanvasEditorSessionRecord("{}")) .toBeNull();
    expect(parseCanvasEditorSessionRecord("not-json")).toBeNull();
  });

  it("accepts only the server record owned by the presented session token", async () => {
    const futureExpiry = new Date(Date.now() + 60_000).toISOString();
    const db = {
      appSetting: {
        findUnique: vi.fn().mockResolvedValue({
          value: JSON.stringify({ sessionId: "session-current", expiresAt: futureExpiry }),
        }),
      },
    };

    await expect(canvasEditorSessionMatches(db, { authUserId: 7, canvasId: 55, sessionId: "session-current" })).resolves.toBe(true);
    await expect(canvasEditorSessionMatches(db, { authUserId: 7, canvasId: 55, sessionId: "session-old" })).resolves.toBe(false);
    expect(db.appSetting.findUnique).toHaveBeenCalledWith({
      where: { key: "canvas.editor-session:7:55" },
      select: { value: true },
    });
  });

  it("rejects a matching session token after its 120 second lease expires", async () => {
    const db = {
      appSetting: {
        findUnique: vi.fn().mockResolvedValue({
          value: JSON.stringify({ sessionId: "session-current", expiresAt: new Date(Date.now() - 1).toISOString() }),
        }),
      },
    };

    await expect(canvasEditorSessionMatches(db, {
      authUserId: 7,
      canvasId: 55,
      sessionId: "session-current",
    })).resolves.toBe(false);
  });

  it("refuses to renew an expired lease even when the session token still matches", async () => {
    routeMocks.getUserId.mockResolvedValue(7);
    routeMocks.canvasFindFirst.mockResolvedValue({ id: 55 });
    routeMocks.appSettingFindUnique.mockResolvedValue({
      value: JSON.stringify({ sessionId: "session-current", expiresAt: new Date(Date.now() - 1).toISOString() }),
    });
    routeMocks.appSettingUpdateMany.mockResolvedValue({ count: 1 });
    const { PUT } = await import("@/app/api/canvas/[id]/session/route");
    const request = new Request("http://localhost/api/canvas/55/session", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: "session-current" }),
    });

    const response = await PUT(request as never, { params: { id: "55" } });

    expect(response).toBeDefined();
    if (!response) throw new Error("expected an expired session response");
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: "CANVAS_SESSION_EXPIRED" });
    expect(routeMocks.appSettingUpdateMany).not.toHaveBeenCalled();
  });

  it("expires the older tab immediately when a newer tab claims the same canvas", async () => {
    const network = new FakeChannelNetwork();
    const firstExpired = vi.fn();
    const secondExpired = vi.fn();
    const fetcher = vi.fn().mockResolvedValue(ok());

    const first = await claimCanvasEditorSession({
      authUserId: 7,
      canvasId: 55,
      sessionId: "session-first",
      fetcher,
      channelFactory: network.create,
      onExpired: firstExpired,
      heartbeatMs: 60_000,
    });
    const second = await claimCanvasEditorSession({
      authUserId: 7,
      canvasId: 55,
      sessionId: "session-second",
      fetcher,
      channelFactory: network.create,
      onExpired: secondExpired,
      heartbeatMs: 60_000,
    });

    expect(firstExpired).toHaveBeenCalledTimes(1);
    expect(secondExpired).not.toHaveBeenCalled();
    expect(fetcher).toHaveBeenNthCalledWith(1, "/api/canvas/55/session", expect.objectContaining({ method: "POST" }));
    first.release();
    second.release();
  });

  it("keeps repeated claims from the same tab alive when an older effect cleans up", async () => {
    const network = new FakeChannelNetwork();
    const firstExpired = vi.fn();
    const secondExpired = vi.fn();
    const pendingClaims: Array<(response: Response) => void> = [];
    const fetcher = vi.fn().mockImplementation(() => new Promise<Response>((resolve) => {
      pendingClaims.push(resolve);
    }));

    const firstClaim = claimCanvasEditorSession({
      authUserId: 7,
      canvasId: 55,
      sessionId: "tab-stable-session",
      fetcher,
      channelFactory: network.create,
      onExpired: firstExpired,
      heartbeatMs: 60_000,
    });
    const secondClaim = claimCanvasEditorSession({
      authUserId: 7,
      canvasId: 55,
      sessionId: "tab-stable-session",
      fetcher,
      channelFactory: network.create,
      onExpired: secondExpired,
      heartbeatMs: 60_000,
    });
    pendingClaims[1](ok());
    const second = await secondClaim;
    pendingClaims[0](ok());
    const first = await firstClaim;

    first.release();

    expect(firstExpired).not.toHaveBeenCalled();
    expect(secondExpired).not.toHaveBeenCalled();
    expect(fetcher.mock.calls.map(([, init]) => init?.method)).toEqual(["POST", "POST"]);
    second.release();
  });

  it("keeps sessions for different canvases independent", async () => {
    const network = new FakeChannelNetwork();
    const firstExpired = vi.fn();
    const secondExpired = vi.fn();
    const fetcher = vi.fn().mockResolvedValue(ok());

    const first = await claimCanvasEditorSession({
      authUserId: 7,
      canvasId: 55,
      sessionId: "session-55",
      fetcher,
      channelFactory: network.create,
      onExpired: firstExpired,
      heartbeatMs: 60_000,
    });
    const second = await claimCanvasEditorSession({
      authUserId: 7,
      canvasId: 56,
      sessionId: "session-56",
      fetcher,
      channelFactory: network.create,
      onExpired: secondExpired,
      heartbeatMs: 60_000,
    });

    expect(firstExpired).not.toHaveBeenCalled();
    expect(secondExpired).not.toHaveBeenCalled();
    first.release();
    second.release();
  });

  it("keeps the same canvas independent across authenticated users", async () => {
    const network = new FakeChannelNetwork();
    const firstExpired = vi.fn();
    const secondExpired = vi.fn();
    const fetcher = vi.fn().mockResolvedValue(ok());

    const first = await claimCanvasEditorSession({
      authUserId: 7,
      canvasId: 55,
      sessionId: "session-user-7",
      fetcher,
      channelFactory: network.create,
      onExpired: firstExpired,
      heartbeatMs: 60_000,
    });
    const second = await claimCanvasEditorSession({
      authUserId: 8,
      canvasId: 55,
      sessionId: "session-user-8",
      fetcher,
      channelFactory: network.create,
      onExpired: secondExpired,
      heartbeatMs: 60_000,
    });

    expect(firstExpired).not.toHaveBeenCalled();
    expect(secondExpired).not.toHaveBeenCalled();
    first.release();
    second.release();
  });

  it("expires when the server heartbeat reports that another browser owns the canvas", async () => {
    vi.useFakeTimers();
    const expired = vi.fn();
    const fetcher = vi.fn()
      .mockResolvedValueOnce(ok())
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: false, code: "CANVAS_SESSION_EXPIRED" }), {
        status: 409,
        headers: { "Content-Type": "application/json" },
      }));

    const session = await claimCanvasEditorSession({
      authUserId: 7,
      canvasId: 55,
      sessionId: "session-old-browser",
      fetcher,
      channelFactory: null,
      onExpired: expired,
      heartbeatMs: 3_000,
    });
    await vi.advanceTimersByTimeAsync(3_000);

    expect(fetcher).toHaveBeenLastCalledWith("/api/canvas/55/session", expect.objectContaining({ method: "PUT" }));
    expect(expired).toHaveBeenCalledTimes(1);
    session.release();
    vi.useRealTimers();
  });
});
