import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ user: vi.fn(), query: vi.fn(), generation: vi.fn() }));
vi.mock("@/lib/server-auth", () => ({ getUserId: mocks.user }));
vi.mock("@/lib/prisma", () => ({ default: { $queryRaw: mocks.query, generation: { findFirst: mocks.generation } } }));
import { GET } from "@/app/api/canvas/media/[mediaId]/route";
const mediaId = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const request = (query = "?generation=1") => new NextRequest(`http://localhost/api/canvas/media/${mediaId}${query}`);
beforeEach(() => {
 vi.clearAllMocks(); mocks.user.mockResolvedValue(7);
 mocks.query.mockResolvedValue([{ id: mediaId, status: "ready", kind: "image", publicUrl: "/uploads/result.png", variants: {}, metadata: { generationId: 12 } }]);
 mocks.generation.mockResolvedValue({ id: 12, authUserId: 7, canvasId: 8, source: "agent", type: "image_edit", status: "success", localPath: "/uploads/result.png", model: "gemini-3-pro-image", prompt: "真实客厅", createdAt: new Date("2026-10-14"), templateData: JSON.stringify({ model: "nano-banana-pro", aspectRatio: "3:4", resolution: "2K", imagePaths: ["/uploads/ref.png"], apiKey: "never-expose" }) });
});
describe("Agent result task recovery", () => {
 it("returns the saved model choice, prompt, parameters and references for an owned Agent result", async () => {
  const body = await (await GET(request(), { params: { mediaId } })).json();
  expect(body.generationCanvasId).toBe(8);
  expect(body.generationTask).toMatchObject({ kind: "imageTask", task: { settings: { model: "nano-banana-pro", prompt: "真实客厅", aspectRatio: "3:4", resolution: "2K" }, references: [{ url: "/uploads/ref.png" }], batches: [{ outputs: [{ generationId: 12, mediaId, url: "/uploads/result.png", status: "success" }] }] } });
  expect(mocks.generation.mock.calls[0][0].where).toMatchObject({ id: 12, authUserId: 7, source: "agent", status: "success" });
  expect(JSON.stringify(body)).not.toMatch(/never-expose|templateData|metadata/);
 });
 it("does not query generation details for an ordinary media hydration request", async () => {
  await GET(request(""), { params: { mediaId } });
  expect(mocks.generation).not.toHaveBeenCalled();
 });
 it("does not expose foreign or mismatched generation data", async () => {
  mocks.generation.mockResolvedValueOnce(null);
  expect((await (await GET(request(), { params: { mediaId } })).json()).generationTask).toBeUndefined();
  mocks.generation.mockResolvedValueOnce({ id: 12, canvasId: 8, type: "image_edit", localPath: "/uploads/other.png" });
  expect((await (await GET(request(), { params: { mediaId } })).json()).generationTask).toBeUndefined();
 });
});
