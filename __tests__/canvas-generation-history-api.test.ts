import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const db = vi.hoisted(() => ({
  generation: { findMany: vi.fn(), findFirst: vi.fn(), count: vi.fn() },
  generationInputMedia: { findMany: vi.fn() }, log: { findMany: vi.fn() },
}));
const auth = vi.hoisted(() => ({ getUserId: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ default: db }));
vi.mock("@/lib/server-auth", () => auth);
import { getCanvasAssetHistory, getCanvasAssetDetail } from "@/lib/assets/canvas-history-server";
const request = (query = "") => new NextRequest(`http://localhost/api/assets?view=canvas-history&${query}`);
const row = (id: number) => ({ id, canvasId: 8, type: "image_edit", createdAt: new Date("2026-09-10T03:00:00Z"), localPath: `/uploads/canvas_image_results/${id}.png`, templateData: JSON.stringify({ outputThumbUrl: `/uploads/generation_previews/${id}.webp`, prompt: "large prompt", imagePaths: ["/uploads/ref.png"] }) });

beforeEach(() => {
  vi.clearAllMocks(); auth.getUserId.mockResolvedValue(7);
  db.generation.findMany.mockResolvedValue([]); db.generation.count.mockResolvedValue(3);
  db.generationInputMedia.findMany.mockResolvedValue([]); db.log.findMany.mockResolvedValue([]);
});
describe("canvas generation asset API", () => {
  it("requires authentication before any database scan", async () => {
    auth.getUserId.mockResolvedValue(null);
    expect((await getCanvasAssetHistory(request())).status).toBe(401);
    expect(db.generation.findMany).not.toHaveBeenCalled();
  });
  it("filters owner, canvas provenance and media on the server, returning a lightweight page", async () => {
    db.generation.findMany.mockResolvedValue([row(3), row(2), row(1)]);
    const payload = await (await getCanvasAssetHistory(request("canvasId=8&type=image&take=2&source=all"))).json();
    expect(payload.items.map((item: any) => item.id)).toEqual([3, 2]);
    expect(payload.items[0]).toMatchObject({ thumbUrl: "/uploads/generation_previews/3.webp", canvasId: 8 });
    expect(payload.items[0]).not.toHaveProperty("templateData");
    expect(payload.items[0]).not.toHaveProperty("prompt");
    expect(db.generation.findMany.mock.calls[0][0]).toMatchObject({ take: 3, where: { AND: [expect.objectContaining({ authUserId: 7, OR: [{ source: "canvas" }, { source: "agent", canvasId: { not: null } }], canvasId: 8, status: "success" }), expect.any(Object)] } });
    expect(db.log.findMany).not.toHaveBeenCalled();
    expect(db.generationInputMedia.findMany).not.toHaveBeenCalled();
    expect(db.generation.count).not.toHaveBeenCalled();
    expect(payload.hasMore).toBe(true);
  });
  it.each(["asc", "desc"])("uses stable time/id keyset pagination for %s, even after deleting a cursor row", async order => {
    db.generation.findMany.mockResolvedValue([row(1), row(2)]);
    const first = await (await getCanvasAssetHistory(request(`order=${order}&take=1`))).json();
    db.generation.findMany.mockResolvedValue([]);
    await getCanvasAssetHistory(request(`order=${order}&take=1&cursor=${first.nextCursor}`));
    const call = db.generation.findMany.mock.calls[1][0];
    expect(call).not.toHaveProperty("skip"); expect(call).not.toHaveProperty("cursor");
    expect(call.orderBy).toEqual([{ createdAt: order }, { id: order }]);
    expect(call.where.AND[2].OR[1]).toEqual({ createdAt: row(1).createdAt, id: { [order === "asc" ? "gt" : "lt"]: 1 } });
    expect((await getCanvasAssetHistory(request(`order=${order}&canvasId=99&cursor=${first.nextCursor}`))).status).toBe(400);
  });
  it.each(["canvasId=0", "canvasId=abc", "type=__proto__", "type=invalid", "cursor=broken"])("rejects invalid scope/filter %s", async query => {
    expect((await getCanvasAssetHistory(request(query))).status).toBe(400);
    expect(db.generation.findMany).not.toHaveBeenCalled();
  });
  it("counts all three media types independently of the current tab without hydrating records", async () => {
    const payload = await (await getCanvasAssetHistory(request("count=1&canvasId=8"))).json();
    expect(payload).toEqual({ image: 3, video: 3, audio: 3 });
    expect(db.generation.findMany).not.toHaveBeenCalled();
    expect(db.generation.count).toHaveBeenCalledTimes(3);
    for (const [args] of db.generation.count.mock.calls) expect(args.where.AND[0]).toMatchObject({ authUserId: 7, OR: [{ source: "canvas" }, { source: "agent", canvasId: { not: null } }], canvasId: 8 });
  });
  it("loads one owned detail, merges reusable references and exposes only display parameters", async () => {
    db.generation.findFirst.mockResolvedValue({ ...row(3), model: "test-model", prompt: "提示词", authUser: { username: "创作者" } });
    db.generationInputMedia.findMany.mockResolvedValue([{ role: "reference_audio", media: { originalKey: "/uploads/ref.mp3", publicUrl: null, kind: "audio" } }]);
    db.log.findMany.mockResolvedValue([{ metadata: JSON.stringify({ resolution: "2K", apiKey: "never-return", imagePaths: ["/uploads/ref.png"] }) }]);
    const payload = await (await getCanvasAssetDetail(request(), 3)).json();
    expect(db.generation.findFirst.mock.calls[0][0].where).toMatchObject({ id: 3, OR: [{ source: "canvas" }, { source: "agent", canvasId: { not: null } }], authUserId: 7 });
    expect(payload.item).toMatchObject({ prompt: "提示词", model: "test-model", params: { resolution: "2K" } });
    expect(payload.item.references).toEqual([expect.objectContaining({ url: "/uploads/ref.mp3", kind: "audio" }), expect.objectContaining({ url: "/uploads/ref.png", kind: "image" })]);
    expect(JSON.stringify(payload)).not.toContain("never-return");
  });
  it("does not retrieve reference information for a missing or foreign detail", async () => {
    db.generation.findFirst.mockResolvedValue(null);
    expect((await getCanvasAssetDetail(request(), 999)).status).toBe(404);
    expect(db.log.findMany).not.toHaveBeenCalled();
  });
  it("returns saved search sources in the owned detail without adding them to list cards", async () => {
    const googleGrounding = { renderedContent: "<div>Google</div>", sources: [{ url: "https://example.com/bird", title: "鸟类资料" }] };
    const saved = { ...row(3), templateData: JSON.stringify({ googleGrounding }) };
    db.generation.findMany.mockResolvedValue([saved]);
    const list = await (await getCanvasAssetHistory(request())).json();
    expect(list.items[0]).not.toHaveProperty("googleGrounding");
    db.generation.findFirst.mockResolvedValue(saved);
    const detail = await (await getCanvasAssetDetail(request(), 3)).json();
    expect(detail.item.googleGrounding).toEqual(googleGrounding);
    expect(db.generation.findFirst.mock.calls[0][0].where).toMatchObject({ authUserId: 7, id: 3 });
  });
});
