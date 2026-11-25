import { afterEach, beforeEach, expect, it, vi } from "vitest";
import path from "node:path";
const mocks = vi.hoisted(() => ({ read: vi.fn(), prepare: vi.fn(), upload: vi.fn(), external: vi.fn(), platform: vi.fn() }));
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, default: { ...actual, readFile: mocks.read } };
});
vi.mock("@/lib/oss", () => ({ isOssReady: async () => true, uploadBufferToOss: mocks.upload }));
vi.mock("@/lib/prompt-reverse-media", () => ({ preparePromptReverseRelayImage: mocks.prepare }));
vi.mock("@/lib/external-assets", () => ({ resolveAssetUrlForExternalApi: mocks.external }));
vi.mock("@/lib/media-delivery/deliver", () => ({ resolveMediaForPlatform: mocks.platform }));
vi.mock("@/lib/public-path", () => ({ resolvePublicPath: (value: string) => path.join("test-public", value) }));
import { resolvePromptReverseMediaUrl } from "@/lib/prompt-reverse-media-url";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("MEDIA_DELIVERY_MODE", "platform");
  mocks.read.mockResolvedValue(Buffer.from("image"));
  mocks.prepare.mockResolvedValue(Buffer.from("jpeg"));
  mocks.upload.mockResolvedValue("https://relay.example/image.jpg");
});

afterEach(() => vi.unstubAllEnvs());

it("sends the prepared image inline to DeepSeek Flash vision in platform-first mode", async () => {
  await expect(resolvePromptReverseMediaUrl("/uploads/image.png", "http://localhost:3100", "deepseek", "deepseek-flash"))
    .resolves.toBe(`data:image/jpeg;base64,${Buffer.from("jpeg").toString("base64")}`);
  expect(mocks.upload).not.toHaveBeenCalled();
});

it("uploads a KIE Gemini image through its own platform in platform-first mode", async () => {
  mocks.platform.mockResolvedValueOnce("https://kie.test/image.png");
  await expect(resolvePromptReverseMediaUrl("/uploads/image.png", "http://localhost:3100", "kie", "gemini-3-8-flash-openai"))
    .resolves.toBe("https://kie.test/image.png");
  expect(mocks.platform).toHaveBeenCalledWith("/uploads/image.png", "prompt-reverse-inputs", { platform: "kie" }, "image");
  expect(mocks.upload).not.toHaveBeenCalled();
});

it.each(["platform", "oss"])("uploads the optimized JPEG to OSS in %s mode when appropriate", async mode => {
  vi.stubEnv("MEDIA_DELIVERY_MODE", mode);
  const provider = mode === "oss" ? "deepseek" : "custom";
  await expect(resolvePromptReverseMediaUrl("/uploads/image.png", "http://localhost:3100", provider, "deepseek-flash"))
    .resolves.toBe("https://relay.example/image.jpg");
  expect(mocks.upload).toHaveBeenCalledWith(Buffer.from("jpeg"), "prompt-reverse-inputs", expect.stringMatching(/\.jpg$/), "image/jpeg");
});

it.each([
  "/uploads/canvas_imports/利文斌_20260923/参考 图.png",
  "/uploads/canvas_imports/%E5%88%A9%E6%96%87%E6%96%8C_20260923/%E5%8F%82%E8%80%83%20%E5%9B%BE.png?version=1",
  "http://localhost:3100/uploads/canvas_imports/%E5%88%A9%E6%96%87%E6%96%8C_20260923/%E5%8F%82%E8%80%83%20%E5%9B%BE.png",
])("reads the decoded local file for %s", async url => {
  await expect(resolvePromptReverseMediaUrl(url, "http://localhost:3100")).resolves.toBe("https://relay.example/image.jpg");
  expect(mocks.read).toHaveBeenCalledWith(path.join("test-public", "uploads/canvas_imports/利文斌_20260923/参考 图.png"));
  expect(mocks.external).not.toHaveBeenCalled();
});

it("decodes literal percent signs only once", async () => {
  await resolvePromptReverseMediaUrl("/uploads/100%25%20done.png", "http://localhost");
  expect(mocks.read).toHaveBeenCalledWith(path.join("test-public", "uploads/100% done.png"));
});

it.each(["/uploads/%2e%2e%2fsecret", "/uploads/%5c..%5csecret", "/uploads/%00.png"])("never reads an invalid local path %s", async url => {
  await resolvePromptReverseMediaUrl(url, "http://localhost");
  expect(mocks.read).not.toHaveBeenCalled();
});
