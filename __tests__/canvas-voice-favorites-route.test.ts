import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireCanvasEntryEnabled: vi.fn(),
  getUserId: vi.fn(),
  resolveMiniMaxVoiceCatalogSource: vi.fn(),
  listCanvasVoiceFavorites: vi.fn(),
  setCanvasVoiceFavorite: vi.fn(),
}));

vi.mock("@/lib/server-auth", () => ({ getUserId: mocks.getUserId }));
vi.mock("@/lib/minimax-speech", () => ({
  resolveMiniMaxVoiceCatalogSource: mocks.resolveMiniMaxVoiceCatalogSource,
}));
vi.mock("@/lib/canvas/voice-favorites", () => ({
  listCanvasVoiceFavorites: mocks.listCanvasVoiceFavorites,
  setCanvasVoiceFavorite: mocks.setCanvasVoiceFavorite,
}));

describe("canvas voice favorites route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireCanvasEntryEnabled.mockResolvedValue(null);
    mocks.getUserId.mockResolvedValue(42);
    mocks.resolveMiniMaxVoiceCatalogSource.mockResolvedValue({
      scopeKey: "scope-a",
      load: vi.fn(),
    });
    mocks.listCanvasVoiceFavorites.mockResolvedValue(["female-shaonv"]);
    mocks.setCanvasVoiceFavorite.mockResolvedValue(undefined);
  });

  it("rejects unauthenticated reads", async () => {
    mocks.getUserId.mockResolvedValue(null);
    const { GET } = await import("@/app/api/canvas/speech/favorites/route");
    const response = await GET(
      new NextRequest("http://localhost/api/canvas/speech/favorites"),
    );
    expect(response.status).toBe(401);
    expect(mocks.listCanvasVoiceFavorites).not.toHaveBeenCalled();
  });

  it("lists only the current user and current provider scope", async () => {
    const { GET } = await import("@/app/api/canvas/speech/favorites/route");
    const response = await GET(
      new NextRequest("http://localhost/api/canvas/speech/favorites"),
    );
    expect(await response.json()).toEqual({
      success: true,
      voiceIds: ["female-shaonv"],
    });
    expect(mocks.listCanvasVoiceFavorites).toHaveBeenCalledWith({
      userId: 42,
      providerScope: "scope-a",
    });
  });

  it("adds one favorite idempotently", async () => {
    const { PUT } = await import("@/app/api/canvas/speech/favorites/route");
    const response = await PUT(
      new NextRequest("http://localhost/api/canvas/speech/favorites", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ voiceId: "female-shaonv", favorite: true }),
      }),
    );
    expect(response.status).toBe(200);
    expect(mocks.setCanvasVoiceFavorite).toHaveBeenCalledWith({
      userId: 42,
      providerScope: "scope-a",
      voiceId: "female-shaonv",
      favorite: true,
    });
  });

  it("removes one favorite idempotently", async () => {
    const { PUT } = await import("@/app/api/canvas/speech/favorites/route");
    const response = await PUT(
      new NextRequest("http://localhost/api/canvas/speech/favorites", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ voiceId: "female-shaonv", favorite: false }),
      }),
    );
    expect(response.status).toBe(200);
    expect(mocks.setCanvasVoiceFavorite).toHaveBeenCalledWith(
      expect.objectContaining({ favorite: false }),
    );
  });

  it.each(["", "x".repeat(257)])(
    "rejects an invalid voice id",
    async (voiceId) => {
      const { PUT } = await import(
        "@/app/api/canvas/speech/favorites/route"
      );
      const response = await PUT(
        new NextRequest("http://localhost/api/canvas/speech/favorites", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ voiceId, favorite: true }),
        }),
      );
      expect(response.status).toBe(400);
      expect(mocks.setCanvasVoiceFavorite).not.toHaveBeenCalled();
    },
  );
});
