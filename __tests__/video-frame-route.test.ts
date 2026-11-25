import { beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(), upsert: vi.fn(),
  save: vi.fn(), display: vi.fn(), feed: vi.fn(), unlink: vi.fn(),
}));
vi.mock("@/lib/server-auth", () => ({ getUserId: mocks.auth }));
vi.mock("@/lib/prisma", () => ({ default: { generation: {
  findFirst: mocks.findFirst, findUnique: mocks.findUnique, upsert: mocks.upsert,
} } }));
vi.mock("@/lib/storage", () => ({ saveBufferFile: mocks.save }));
vi.mock("@/lib/admin-asset-feed", () => ({ upsertAdminAssetFeedForGenerationId: mocks.feed }));
vi.mock("node:fs/promises", () => ({ unlink: mocks.unlink }));
vi.mock("@/lib/public-path", () => ({ resolvePublicPath: (value: string) => `/test/${value}` }));
vi.mock("@/lib/generation-display-assets", async (original) => ({
  ...await original<typeof import("@/lib/generation-display-assets")>(),
  createGenerationDisplayAssetPatch: mocks.display,
}));
import { POST } from "@/app/api/video-frames/route";

let png: Buffer;
const key = "2b1c59cd-8109-45fd-b8bc-940f4a01fb1a";
const outputPath = "/uploads/image_results/test.png";
async function request(fields: Record<string, string | undefined> = {}, bytes?: Buffer) {
  const form = new FormData();
  Object.entries({ generationId: "12", mode: "current", time: "3.5", requestKey: key, ...fields }).forEach(([key, value]) => {
    if (value !== undefined) form.set(key, value);
  });
  form.set("file", new Blob([new Uint8Array(bytes || png)], { type: "image/png" }), "frame.png");
  return POST(new NextRequest("http://localhost/api/video-frames", { method: "POST", body: form }));
}
beforeEach(async () => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue(7);
  mocks.findFirst.mockResolvedValue({ id: 12 });
  mocks.findUnique.mockResolvedValue(null);
  mocks.save.mockResolvedValue(outputPath);
  mocks.display.mockResolvedValue({ outputPreviewUrl: "/uploads/previews/frame.webp" });
  mocks.upsert.mockImplementation(async ({ create }) => ({ id: 44, createdAt: new Date(), ...create }));
  mocks.feed.mockResolvedValue(undefined);
  mocks.unlink.mockResolvedValue(undefined);
  png = await sharp({ create: { width: 64, height: 36, channels: 3, background: "red" } }).png().toBuffer();
});

describe("persisted video frames", () => {
  it.each(["current", "first", "last"])("saves %s as an independent downloadable image and returns history metadata", async mode => {
    const response = await request({ mode });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.item).toMatchObject({ id: 44, authUserId: 7, userId: "7", source: "tool", type: "image_edit", status: "success", model: "video-frame", localPath: outputPath, displayKind: "image" });
    expect(body.item.params).toMatchObject({ sourceGenerationId: 12, phase: "ready", videoFrame: { mode, time: 3.5, width: 64, height: 36 } });
    expect(mocks.save).toHaveBeenCalledWith(expect.any(Buffer), "image_results", { contentType: "image/png" });
    expect(mocks.unlink).not.toHaveBeenCalled();
  });
  it("requires a login before parsing or saving", async () => {
    mocks.auth.mockResolvedValue(null);
    expect((await request()).status).toBe(401);
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("only accepts the signed-in user's completed studio videos", async () => {
    mocks.findFirst.mockResolvedValue(null);
    expect((await request()).status).toBe(404);
    expect(mocks.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ authUserId: 7, source: "tool", status: "success", type: { in: ["video_gen", "video_generate"] } }) }));
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it.each([{ mode: "middle" }, { mode: "toString" }, { time: "NaN" }, { time: "-1" }, { generationId: "0" }, { requestKey: "bad" }])("rejects invalid parameters %j", async fields => {
    expect((await request(fields)).status).toBe(400);
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("rejects disguised non-images", async () => {
    expect((await request({}, Buffer.from("not an image"))).status).toBe(400);
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("returns an existing operation without saving it twice", async () => {
    mocks.findUnique.mockResolvedValue({ id: 44, authUserId: 7, model: "video-frame", templateData: null, localPath: outputPath });
    expect((await request()).status).toBe(200);
    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("does not disclose another user's request-key result", async () => {
    mocks.findUnique.mockResolvedValue({ authUserId: 99, model: "video-frame" });
    expect((await request()).status).toBe(409);
  });
  it("removes only newly written files if persistence fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.upsert.mockRejectedValueOnce(new Error("DB unavailable"));
    expect((await request()).status).toBe(500);
    expect(mocks.unlink.mock.calls.flat()).toEqual(["/test/uploads/image_results/test.png", "/test/uploads/previews/frame.webp"]);
  });
  it("cleans a racing duplicate's files while preserving the winning record", async () => {
    mocks.upsert.mockResolvedValue({ id: 43, authUserId: 7, model: "video-frame", templateData: null, localPath: "/uploads/image_results/winner.png" });
    const body = await (await request()).json();
    expect(body.item.id).toBe(43);
    expect(mocks.unlink).toHaveBeenCalledTimes(2);
    expect(mocks.unlink).not.toHaveBeenCalledWith(expect.stringContaining("winner"));
  });
});
