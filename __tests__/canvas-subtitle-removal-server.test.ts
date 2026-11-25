import { afterEach, beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ probe: vi.fn(), realpath: vi.fn(), config: vi.fn(), submit: vi.fn(), upload: vi.fn(), relay: vi.fn(), create: vi.fn(), update: vi.fn(), existing: vi.fn(), billing: vi.fn() }));
vi.mock("node:fs/promises", () => ({ default: { realpath: m.realpath, stat: async () => ({ isFile: () => true, size: 100 }) } }));
vi.mock("@/lib/storage", () => ({ resolveUploadsRootDirectory: () => process.platform === "win32" ? "C:\\uploads" : "/uploads" }));
vi.mock("@/lib/prisma", () => ({ default: { generation: { create: m.create, update: m.update, findFirst: m.existing } } }));
vi.mock("@/lib/canvas/media-upload-service", () => ({ probeCanvasMedia: m.probe }));
vi.mock("@/lib/external-assets", () => ({ resolveAssetUrlForExternalApi: m.relay }));
vi.mock("@/lib/runtime-generation-budget", () => ({ reserveRuntimeGeneration: vi.fn() }));
vi.mock("@/lib/billing/admission", () => ({ assertBillingReady: m.billing }));
vi.mock("@/lib/billing-ledger", () => ({ upsertUsageLedgerForGenerationId: async () => {} }));
vi.mock("@/lib/volcengine-mediakit", () => ({ requireMediaKitProvider: m.config, submitMediaKitSubtitleRemoval: m.submit, uploadMediaKitVideo: m.upload, MediaKitError: class extends Error { constructor(message: string, public status: number) { super(message); } } }));
import { createSubtitleRemovalGeneration } from "@/lib/canvas/subtitle-removal-server";
import { MediaKitError } from "@/lib/volcengine-mediakit";
import { MEDIAKIT_SUBTITLE_MODEL, MEDIAKIT_PROVIDER } from "@/lib/volcengine-mediakit-models";
const input = { sourceUrl: "/uploads/source.mp4", authUserId: 3, canvasId: 8, requestKey: "stable-request", options: { mode: "auto" as const } };
beforeEach(() => {
  vi.stubEnv("INKVIA_DESKTOP_MODE", "0");
  vi.stubEnv("MEDIA_DELIVERY_MODE", "oss");
  vi.clearAllMocks(); m.realpath.mockImplementation(async path => path); m.config.mockResolvedValue({}); m.existing.mockResolvedValue(null);
  m.probe.mockResolvedValue({ width: 834, height: 1112, durationSeconds: 15.5 });
  m.relay.mockResolvedValue("https://media.example.com/source.mp4"); m.create.mockResolvedValue({ id: 17 }); m.submit.mockResolvedValue("cloud-task-1"); m.billing.mockResolvedValue(undefined);
  m.upload.mockResolvedValue("mediakit://source-id");
});
afterEach(() => vi.unstubAllEnvs());
it("persists a generation and its cloud id then returns immediately for durable polling", async () => {
  await expect(createSubtitleRemovalGeneration(input)).resolves.toEqual({ generationId: 17 });
  const record = m.create.mock.calls[0][0].data;
  expect(record).toMatchObject({ model: MEDIAKIT_SUBTITLE_MODEL, externalProvider: MEDIAKIT_PROVIDER, canvasId: 8, requestKey: "stable-request" });
  expect(JSON.parse(record.templateData)).toMatchObject({ duration: 15.5, billing: { unitType: "minute" } });
  expect(m.update).toHaveBeenCalledWith({ where: { id: 17 }, data: { externalTaskId: "cloud-task-1" } });
  expect(m.upload).not.toHaveBeenCalled();
});
it.each(["0", "1"])("uses the MediaKit URI in platform mode with INKVIA_DESKTOP_MODE=%s", async desktopMode => {
  vi.stubEnv("INKVIA_DESKTOP_MODE", desktopMode);
  vi.stubEnv("MEDIA_DELIVERY_MODE", "platform");
  await expect(createSubtitleRemovalGeneration(input)).resolves.toEqual({ generationId: 17 });
  expect(m.upload).toHaveBeenCalledWith(expect.stringMatching(/[/\\]source\.mp4$/), 100);
  expect(m.relay).not.toHaveBeenCalled();
  expect(m.submit).toHaveBeenCalledWith(expect.objectContaining({ videoUrl: "mediakit://source-id" }));
});
it("falls back to the original OSS resolver if MediaKit local upload fails", async () => {
  vi.stubEnv("MEDIA_DELIVERY_MODE", "platform");
  m.upload.mockRejectedValueOnce(new Error("AI MediaKit 本地视频上传失败（HTTP 403）"));
  await expect(createSubtitleRemovalGeneration(input)).resolves.toEqual({ generationId: 17 });
  expect(m.upload).toHaveBeenCalledTimes(1);
  expect(m.relay).toHaveBeenCalledWith(input.sourceUrl, "canvas-provider-inputs");
  expect(m.submit).toHaveBeenCalledWith(expect.objectContaining({ videoUrl: "https://media.example.com/source.mp4" }));
});
it("uses OSS without trying MediaKit in forced OSS mode on desktop", async () => {
  vi.stubEnv("INKVIA_DESKTOP_MODE", "1");
  await expect(createSubtitleRemovalGeneration(input)).resolves.toEqual({ generationId: 17 });
  expect(m.upload).not.toHaveBeenCalled();
  expect(m.submit).toHaveBeenCalledWith(expect.objectContaining({ videoUrl: "https://media.example.com/source.mp4" }));
});
it("shows the native failure and OSS setup when both methods fail", async () => {
  vi.stubEnv("MEDIA_DELIVERY_MODE", "platform");
  m.upload.mockRejectedValueOnce(new Error("AI MediaKit 本地视频上传失败（HTTP 403）"));
  m.relay.mockRejectedValueOnce(new Error("请在系统设置中配置阿里云 OSS"));
  await expect(createSubtitleRemovalGeneration(input)).rejects.toThrow(/MediaKit.*403.*阿里云 OSS/);
  expect(m.submit).not.toHaveBeenCalled();
});
it.each(["https://example.com/a.mp4", "/uploads/../secret", "/uploads/a\\b.mp4"])("rejects unsafe sources %s before paid submission", async sourceUrl => {
  await expect(createSubtitleRemovalGeneration({ ...input, sourceUrl })).rejects.toThrow(); expect(m.submit).not.toHaveBeenCalled();
});
it("rejects a symlink outside uploads", async () => {
  const uploadsRoot = process.platform === "win32" ? "C:\\uploads" : "/uploads";
  const outsidePath = process.platform === "win32" ? "C:\\outside\\video.mp4" : "/outside/video.mp4";
  m.realpath.mockResolvedValueOnce(uploadsRoot).mockResolvedValueOnce(outsidePath);
  await expect(createSubtitleRemovalGeneration(input)).rejects.toThrow("路径"); expect(m.submit).not.toHaveBeenCalled();
});
it("checks admin key and active pricing before a paid request", async () => {
  m.config.mockRejectedValueOnce(new Error("未配置 Key"));
  await expect(createSubtitleRemovalGeneration(input)).rejects.toThrow("未配置 Key");
  m.billing.mockRejectedValueOnce(new Error("尚未配齐价格"));
  await expect(createSubtitleRemovalGeneration(input)).rejects.toThrow("尚未配齐价格");
  expect(m.submit).not.toHaveBeenCalled();
});
it("reuses existing requests without another paid call", async () => {
  m.existing.mockResolvedValue({ id: 17, status: "running", externalTaskId: "cloud-task-1" });
  await expect(createSubtitleRemovalGeneration(input)).resolves.toEqual({ generationId: 17 }); expect(m.submit).not.toHaveBeenCalled();
});
it("marks a known provider rejection failed", async () => {
  m.submit.mockRejectedValueOnce(new MediaKitError("权限不足", 403));
  await expect(createSubtitleRemovalGeneration(input)).rejects.toThrow("权限不足");
  expect(m.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "failed" }) }));
});
it("never silently retries an uncertain paid submission", async () => {
  m.submit.mockRejectedValueOnce(new Error("timeout"));
  await expect(createSubtitleRemovalGeneration(input)).rejects.toThrow("提交结果未确认");
  expect(m.submit).toHaveBeenCalledTimes(1); expect(m.update).not.toHaveBeenCalled();
});
