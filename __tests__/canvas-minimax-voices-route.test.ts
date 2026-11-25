import { NextRequest } from "next/server";
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), entry: vi.fn(), source: vi.fn(), cached: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn(), deleteMany: vi.fn(), deleteFavorites: vi.fn(), removeRemote: vi.fn(), invalidate: vi.fn() }));
vi.mock("@/lib/server-auth", () => ({ getUserId: mocks.auth }));
vi.mock("@/lib/minimax-speech", () => ({ resolveMiniMaxVoiceCatalogSource: mocks.source }));
vi.mock("@/lib/minimax-voice-cache", () => ({ getCachedMiniMaxVoices: mocks.cached, invalidateMiniMaxVoiceCache: mocks.invalidate }));
vi.mock("@/lib/prisma", () => ({ prisma: { appSetting: { findMany: mocks.findMany, findUnique: mocks.findUnique, update: mocks.update, deleteMany: mocks.deleteMany }, canvasVoiceFavorite: { deleteMany: mocks.deleteFavorites }, $transaction: (operations: Promise<unknown>[]) => Promise.all(operations) } }));
import { GET, PATCH, DELETE } from "@/app/api/canvas/speech/voices/route";
const request = () => new NextRequest("http://localhost/api/canvas/speech/voices");
beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue(42);
  mocks.entry.mockResolvedValue(null);
  mocks.source.mockResolvedValue({ scopeKey: "provider-a", load: vi.fn(), deleteClonedVoice: mocks.removeRemote });
  mocks.cached.mockResolvedValue({ voices: [], stale: false, fetchedAt: Date.now() });
  mocks.findMany.mockResolvedValue([{ value: JSON.stringify({
    id: "created-voice", name: "上传样本", source: "cloned", description: "", gender: "unknown", age: "unknown", createdAt: Date.now(),
  }) }]);
});

it("shows a saved clone before MiniMax includes it in get_voice", async () => {
  const response = await GET(request());
  const body = await response.json();
  expect(body.success).toBe(true);
  expect(body.voices).toEqual([expect.objectContaining({ id: "created-voice", name: "上传样本", source: "cloned" })]);
  expect(mocks.findMany.mock.calls[0][0].where.key.startsWith).toBe("canvas_cloned_voice:42:provider-a:");
  expect(response.headers.get("cache-control")).toBe("private, no-store");
});

it("keeps the saved clone visible when the upstream list is temporarily unavailable", async () => {
  mocks.cached.mockRejectedValue(new Error("upstream unavailable"));
  const body = await (await GET(request())).json();
  expect(body.stale).toBe(true);
  expect(body.voices[0].id).toBe("created-voice");
});

it("does not read private clones without authentication", async () => {
  mocks.auth.mockResolvedValue(null);
  expect((await GET(request())).status).toBe(401);
  expect(mocks.findMany).not.toHaveBeenCalled();
});

const patch = (body: unknown) => new NextRequest("http://localhost/api/canvas/speech/voices", {
  method: "PATCH", body: JSON.stringify(body), headers: { "Content-Type": "application/json" },
});
it("persists a trimmed name under the authenticated user's provider", async () => {
  mocks.findUnique.mockResolvedValue({ value: JSON.stringify({ id: "created-voice", name: "旧名", createdAt: 123 }) });
  const response = await PATCH(patch({ voiceId: "created-voice", name: "  新名称  " }));
  expect(await response.json()).toEqual({ success: true, voiceId: "created-voice", name: "新名称" });
  expect(mocks.update.mock.calls[0][0].where.key).toBe("canvas_cloned_voice:42:provider-a:created-voice");
  expect(JSON.parse(mocks.update.mock.calls[0][0].data.value).createdAt).toBe(123);
});
it.each(["", "   ", "x".repeat(121), 123])("rejects invalid names: %s", async name => {
  expect((await PATCH(patch({ voiceId: "created-voice", name }))).status).toBe(400);
  expect(mocks.update).not.toHaveBeenCalled();
});
it("cannot rename someone else's voice", async () => {
  mocks.findUnique.mockResolvedValue(null);
  expect((await PATCH(patch({ voiceId: "other-voice", name: "新名" }))).status).toBe(404);
  expect(mocks.update).not.toHaveBeenCalled();
});
it("requires login before renaming", async () => {
  mocks.auth.mockResolvedValue(null);
  expect((await PATCH(patch({ voiceId: "created-voice", name: "新名" }))).status).toBe(401);
  expect(mocks.update).not.toHaveBeenCalled();
});

const deletion = (voiceId: unknown = "created-voice") => new NextRequest("http://localhost/api/canvas/speech/voices", {
  method: "DELETE", body: JSON.stringify({ voiceId }), headers: { "Content-Type": "application/json" },
});
it("deletes an owned clone remotely, then removes its saved metadata and favorites", async () => {
  mocks.findUnique.mockResolvedValue({ value: JSON.stringify({ id: "created-voice", source: "cloned" }) });
  const response = await DELETE(deletion());
  expect(response.status).toBe(200);
  expect(mocks.removeRemote).toHaveBeenCalledWith("created-voice");
  expect(mocks.findUnique.mock.calls[0][0].where.key).toBe("canvas_cloned_voice:42:provider-a:created-voice");
  expect(mocks.deleteMany).toHaveBeenCalledWith({ where: { key: "canvas_cloned_voice:42:provider-a:created-voice" } });
  expect(mocks.deleteFavorites).toHaveBeenCalledWith({ where: { userId: 42, providerScope: "provider-a", voiceId: "created-voice" } });
  expect(mocks.removeRemote.mock.invocationCallOrder[0]).toBeLessThan(mocks.deleteMany.mock.invocationCallOrder[0]);
  expect(mocks.invalidate).toHaveBeenCalledWith("provider-a");
});
it("preserves local records when MiniMax refuses deletion", async () => {
  mocks.findUnique.mockResolvedValue({ value: JSON.stringify({ id: "created-voice", source: "cloned" }) });
  mocks.removeRemote.mockRejectedValue(new Error("删除失败"));
  expect((await DELETE(deletion())).status).toBe(502);
  expect(mocks.deleteMany).not.toHaveBeenCalled();
  expect(mocks.deleteFavorites).not.toHaveBeenCalled();
});
it("cannot delete an unowned or system voice", async () => {
  mocks.findUnique.mockResolvedValue(null);
  expect((await DELETE(deletion("other-voice"))).status).toBe(404);
  mocks.findUnique.mockResolvedValue({ value: JSON.stringify({ id: "system", source: "system" }) });
  expect((await DELETE(deletion("system"))).status).toBe(404);
  expect(mocks.removeRemote).not.toHaveBeenCalled();
});
it("requires login and a valid voice ID before deletion", async () => {
  mocks.auth.mockResolvedValue(null);
  expect((await DELETE(deletion())).status).toBe(401);
  mocks.auth.mockResolvedValue(42);
  expect((await DELETE(deletion(""))).status).toBe(400);
  expect(mocks.removeRemote).not.toHaveBeenCalled();
});
