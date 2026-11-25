import { beforeEach, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
const mocks = vi.hoisted(() => ({ resolve: vi.fn(), fetch: vi.fn() }));
vi.mock("@/lib/providers/resolve", () => ({ resolveProvider: mocks.resolve }));
vi.mock("@/lib/providers/transport", () => ({ providerFetch: mocks.fetch }));
import { submitMediaKitSubtitleRemoval, getMediaKitSubtitleTask, parseMediaKitSubtitleTask, uploadMediaKitVideo } from "@/lib/volcengine-mediakit";
import { MEDIAKIT_SUBTITLE_MODEL, MEDIAKIT_PROVIDER } from "@/lib/volcengine-mediakit-models";
const input = { videoUrl: "https://media.example.com/source.mp4", options: { mode: "auto" as const }, requestKey: "a-stable-request" };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolve.mockResolvedValue({ apiKey: "saved-key", baseUrl: "https://mediakit.cn-beijing.volces.com", videoModels: [MEDIAKIT_SUBTITLE_MODEL] });
  mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ success: true, task_id: "amk-task-1" })));
});
it("submits V5 with the saved key and a stable idempotency token", async () => {
  await expect(submitMediaKitSubtitleRemoval(input)).resolves.toBe("amk-task-1");
  const [provider, url, init] = mocks.fetch.mock.calls[0];
  expect(provider).toBe(MEDIAKIT_PROVIDER);
  expect(url).toBe("https://mediakit.cn-beijing.volces.com/api/v1/tools/erase-video-subtitle-pro");
  expect(init.headers.Authorization).toBe("Bearer saved-key");
  expect(JSON.parse(init.body)).toEqual({ video_url: input.videoUrl, model_version: "v5", mode: "Subtitle", output_encode_mode: "Quality", client_token: input.requestKey });
});
it("preserves multiple normalized boxes instead of combining their gap", async () => {
  await submitMediaKitSubtitleRemoval({ ...input, options: { mode: "region", regions: [
    { x: .1, y: .1, width: .2, height: .2 }, { x: .1, y: .8, width: .7, height: .1 },
  ] } });
  const body = JSON.parse(mocks.fetch.mock.calls[0][2].body);
  expect(body.mode).toBe("Text");
  expect(body.erase_ratio_location).toHaveLength(2);
  expect(body.erase_ratio_location[0]).toMatchObject({ top_left_x: .1, top_left_y: .1 });
  expect(body.erase_ratio_location[1].bottom_right_y).toBeCloseTo(.9);
});
it.each([null, { apiKey: "", videoModels: [MEDIAKIT_SUBTITLE_MODEL] }, { apiKey: "key", videoModels: [] }])("does not submit when provider/key/model is unavailable", async config => {
  mocks.resolve.mockResolvedValue(config);
  await expect(submitMediaKitSubtitleRemoval(input)).rejects.toThrow();
  expect(mocks.fetch).not.toHaveBeenCalled();
});
it("polls using the stored cloud task id", async () => {
  mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ success: true, status: "processing" })));
  expect(parseMediaKitSubtitleTask(await getMediaKitSubtitleTask("amk-task-1"))).toEqual({ kind: "pending", providerStatus: "processing" });
  expect(mocks.fetch.mock.calls[0][1]).toContain("/api/v1/tasks/amk-task-1");
});
it("maps completion, usage, and explicit failure", () => {
  expect(parseMediaKitSubtitleTask({ status: "completed", result: { video_url: "https://media.example.com/out.mp4", duration: 15.5 } })).toMatchObject({ kind: "done", urls: ["https://media.example.com/out.mp4"], providerUsage: { duration: 15.5 } });
  expect(parseMediaKitSubtitleTask({ status: "failed", error: { message: "invalid video" } })).toMatchObject({ kind: "failed", message: "invalid video" });
  expect(parseMediaKitSubtitleTask({ status: "completed", result: {} }).kind).toBe("failed");
});
it("redacts credentials from provider errors", async () => {
  mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ success: false, error: { message: "invalid saved-key" } }), { status: 401 }));
  await expect(submitMediaKitSubtitleRemoval(input)).rejects.toThrow("[REDACTED]");
});

it.each(["mediakit://source-id", "source-id"])("streams the file to a MediaKit signed URL and returns a usable URI for %s", async fileId => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "mediakit-upload-test-"));
  const file = path.join(directory, "source.mov");
  const bytes = Buffer.from([0, 24, 255]);
  await writeFile(file, bytes);
  const signedUrl = "https://tob-upload-y.volcvod.com/media/source.mov?Signature=mock";
  try {
    mocks.fetch.mockResolvedValueOnce(Response.json({ success: true, result: {
      file_id: fileId, method: "PUT", upload_url: signedUrl, upload_headers: [{ key: "x-tos-meta-test", value: "keep" }],
    } })).mockImplementationOnce(async (provider, target, init) => {
      expect(provider).toBe(MEDIAKIT_PROVIDER);
      expect(String(target)).toBe(signedUrl);
      expect(init).toMatchObject({ method: "PUT", redirect: "error", duplex: "half" });
      const headers = new Headers(init.headers);
      expect(headers.get("authorization")).toBeNull();
      expect(headers.get("content-type")).toBe("video/quicktime");
      expect(headers.get("content-length")).toBe(String(bytes.length));
      expect(headers.get("x-tos-meta-test")).toBe("keep");
      const received: Buffer[] = [];
      for await (const chunk of init.body) received.push(chunk);
      expect(Buffer.concat(received)).toEqual(bytes);
      return new Response(null, { status: 204 });
    });
    const videoUrl = await uploadMediaKitVideo(file, bytes.length);
    expect(videoUrl).toBe("mediakit://source-id");
    expect(mocks.fetch.mock.calls[0]).toMatchObject([MEDIAKIT_PROVIDER, "https://mediakit.cn-beijing.volces.com/api/v1/tools-sync/request-media-upload-url", { method: "POST", body: "{}", headers: { Authorization: "Bearer saved-key" } }]);
    await submitMediaKitSubtitleRemoval({ ...input, videoUrl });
    expect(JSON.parse(mocks.fetch.mock.calls[2][2].body)).toMatchObject({ video_url: "mediakit://source-id", model_version: "v5" });
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

it("rejects a signed upload URL outside the MediaKit storage hosts", async () => {
  mocks.fetch.mockResolvedValueOnce(Response.json({ success: true, result: {
    file_id: "mediakit://source-id", method: "PUT", upload_url: "https://tob-upload-y.volcvod.com.other.example/file",
  } }));
  await expect(uploadMediaKitVideo("source.mp4", 3)).rejects.toThrow("上传地址无效");
  expect(mocks.fetch).toHaveBeenCalledTimes(1);
});
