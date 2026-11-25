import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  oss: vi.fn(async () => "https://oss.example/relay.png"),
  fetch: vi.fn(),
  probe: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/external-assets", () => ({ resolveAssetUrlForExternalApi: mocks.oss }));
vi.mock("@/lib/ssrf-guard", () => ({ safeFetch: mocks.probe }));
vi.mock("@/lib/providers/transport", () => ({
  resolveProviderRequestContext: vi.fn(async (id: string) => {
    return {
      provider: { id, name: id, apiKey: `key-${id}`, baseUrl: id === "apimart" ? "https://api.apimart.ai/v1" : id === "minimax" ? "https://api.minimaxi.com/v1" : id === "volcengine" ? "https://ark.cn-beijing.volces.com" : "https://llm-ws.cn-beijing.maas.aliyuncs.com/compatible-mode/v1" },
      decision: { mode: "direct" },
    };
  }),
  fetchWithProviderEgress: mocks.fetch,
}));
vi.mock("@/lib/providers/resolve", () => ({ resolvedProviderApiKey: (provider: { apiKey: string }) => provider.apiKey }));

const uploadsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "media-delivery-"));
fs.mkdirSync(path.join(uploadsRoot, "ref"), { recursive: true });
fs.writeFileSync(path.join(uploadsRoot, "ref", "a.png"), Buffer.from("89504e470d0a1a0a", "hex"));
fs.writeFileSync(path.join(uploadsRoot, "ref", "a.gif"), Buffer.from("GIF89a"));
fs.writeFileSync(path.join(uploadsRoot, "ref", "a.mp4"), Buffer.from("0000001866747970", "hex"));
fs.writeFileSync(path.join(uploadsRoot, "ref", "a.webm"), "webm");
process.env.UPLOADS_DIR = uploadsRoot;

const { deliverMediaForPlatform, platformHandlesMedia, platformReadsLocalFile } = await import("@/lib/media-delivery/deliver");
const { platformDeliveryMethod, MEDIA_DELIVERY_PLATFORMS } = await import("@/lib/media-delivery/catalog");

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

beforeEach(() => {
  process.env.MEDIA_DELIVERY_MODE = "platform";
  vi.stubEnv("INKVIA_DESKTOP_MODE", "");
  mocks.oss.mockClear();
  mocks.fetch.mockReset();
  mocks.probe.mockReset();
});
afterAll(() => {
  process.env.MEDIA_DELIVERY_MODE = "oss";
  fs.rmSync(uploadsRoot, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

describe("media delivery catalog", () => {
  it("identifies adapters that read local images in either delivery mode", () => {
    for (const mode of ["platform", "oss"]) {
      process.env.MEDIA_DELIVERY_MODE = mode;
      expect(platformReadsLocalFile({ platform: "google-ai-studio" }, "image")).toBe(true);
      expect(platformReadsLocalFile({ platform: "tuzi" }, "image")).toBe(true);
      expect(platformReadsLocalFile({ platform: "kie" }, "image")).toBe(false);
      expect(platformReadsLocalFile(null, "image")).toBe(false);
    }
  });

  it("lists every platform with a reason and defaults unknown platforms to Aliyun OSS", () => {
    for (const entry of MEDIA_DELIVERY_PLATFORMS) expect(entry.note.length).toBeGreaterThan(0);
    expect(platformDeliveryMethod("kie", "video")).toBe("platform-upload");
    expect(platformDeliveryMethod("volcengine", "video")).toBe("platform-upload");
    expect(platformDeliveryMethod("some-new-platform", "image")).toBe("oss");
  });
});

describe("deliverMediaForPlatform", () => {
  it("embeds images as Base64 for Volcengine and skips OSS", async () => {
    const result = await deliverMediaForPlatform("/uploads/ref/a.png", "seedream-inputs", { platform: "volcengine" });
    expect(result.via).toBe("inline-base64");
    expect(result.url).toMatch(/^data:image\/png;base64,/);
    expect(mocks.oss).not.toHaveBeenCalled();
  });

  it("falls back to OSS for formats a platform cannot take as Base64", async () => {
    const result = await deliverMediaForPlatform("/uploads/ref/a.gif", "openrouter-image-inputs", { platform: "openrouter" });
    expect(result).toEqual({ url: "https://oss.example/relay.png", via: "oss" });
  });

  it("uploads to KIE's own temporary storage", async () => {
    mocks.fetch.mockResolvedValueOnce(json({ success: true, code: 200, data: { downloadUrl: "https://tempfile.redpandaai.co/x/a.png" } }));
    const result = await deliverMediaForPlatform("/uploads/ref/a.png", "kie-image-edit-inputs", { platform: "kie" });
    expect(result).toEqual({ url: "https://tempfile.redpandaai.co/x/a.png", via: "platform-upload" });
    expect(String(mocks.fetch.mock.calls[0][1])).toBe("https://kieai.redpandaai.co/api/file-stream-upload");
  });

  it("uploads APIMart videos to the video endpoint with 3-day retention", async () => {
    mocks.fetch.mockResolvedValueOnce(json({ url: "https://getapib.org/video/a.mp4" }));
    const result = await deliverMediaForPlatform("/uploads/ref/a.mp4", "apimart_seedance", { platform: "apimart" });
    expect(result.via).toBe("platform-upload");
    expect(String(mocks.fetch.mock.calls[0][1])).toBe("https://api.apimart.ai/v1/uploads/videos?retention_days=3");
  });

  it("uploads to Bailian temporary storage bound to the model and returns oss://", async () => {
    mocks.fetch
      .mockResolvedValueOnce(json({ data: { upload_host: "https://dashscope-file.oss.example", upload_dir: "dashscope-instant/u/d", oss_access_key_id: "id", signature: "sig", policy: "p", x_oss_object_acl: "private", x_oss_forbid_overwrite: "true" } }))
      .mockResolvedValueOnce(new Response("", { status: 200 }));
    const result = await deliverMediaForPlatform("/uploads/ref/a.png", "bailian", { platform: "bailian", model: "qwen-image-3.0" });
    expect(result.via).toBe("platform-upload");
    expect(result.url).toMatch(/^oss:\/\/dashscope-instant\/u\/d\/.+\.png$/);
    expect(String(mocks.fetch.mock.calls[0][1])).toBe("https://llm-ws.cn-beijing.maas.aliyuncs.com/api/v1/uploads?action=getPolicy&model=qwen-image-3.0");
  });

  it("falls back to Aliyun OSS when the platform upload fails", async () => {
    mocks.fetch.mockResolvedValueOnce(json({ success: false, code: 401, msg: "bad key" }));
    vi.spyOn(console, "warn").mockImplementationOnce(() => undefined);
    const result = await deliverMediaForPlatform("/uploads/ref/a.png", "kie-image-edit-inputs", { platform: "kie" });
    expect(result).toEqual({ url: "https://oss.example/relay.png", via: "oss" });
  });

  it("uses Aliyun OSS for platforms without hosting and for every platform in OSS mode", async () => {
    expect((await deliverMediaForPlatform("/uploads/ref/a.png", "aicoming", { platform: "aicoming-haiya" })).via).toBe("oss");
    process.env.MEDIA_DELIVERY_MODE = "oss";
    expect((await deliverMediaForPlatform("/uploads/ref/a.png", "seedream-inputs", { platform: "volcengine" })).via).toBe("oss");
    expect(await platformHandlesMedia({ platform: "kie" }, "image")).toBe(false);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("leaves remote URLs to the existing resolver", async () => {
    const result = await deliverMediaForPlatform("https://cdn.example/a.png", "x", { platform: "kie" });
    expect(result.via).toBe("unchanged");
  });
});

describe("native provider ways", () => {
  const arkVideoTarget = { platform: "volcengine", model: "doubao-seedance-2-5-260628" };
  const arkFileUrl = "https://ark-temp.tos-cn-beijing.volces.com/clip.mp4?X-Tos-Signature=fixture";

  it("uses Ark's signed HTTPS download URL for a local Seedance reference video", async () => {
    mocks.fetch.mockResolvedValueOnce(json({ id: "file-ark-video", status: "active", download_url: arkFileUrl }));
    mocks.probe.mockResolvedValueOnce(new Response("x", { status: 206, headers: { "Content-Type": "video/mp4" } }));
    const result = await deliverMediaForPlatform("/uploads/ref/a.mp4", "seedance", arkVideoTarget, "video");
    expect(result).toEqual({ url: arkFileUrl, via: "platform-upload" });
    const [decision, url, init] = mocks.fetch.mock.calls[0];
    expect(decision).toEqual({ mode: "direct" });
    expect(url).toBe("https://ark.cn-beijing.volces.com/api/v3/files");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ Authorization: "Bearer key-volcengine" });
    expect(init.body.get("purpose")).toBe("agent");
    expect(init.body.get("tos")).toBeNull();
    expect(init.body.get("file").type).toBe("video/mp4");
    expect(mocks.probe.mock.calls[0].slice(0, 2)).toEqual([arkFileUrl, expect.objectContaining({ headers: { Range: "bytes=0-0" } })]);
    expect(mocks.oss).not.toHaveBeenCalled();
  });

  it.each(["upload rejected", "link missing", "link inaccessible"])("falls back for an Ark video when %s", async (failure) => {
    mocks.fetch.mockResolvedValueOnce(failure === "upload rejected" ? json({}, 403) : json({ id: "file-ark-video", status: "active", ...(failure === "link inaccessible" && { download_url: arkFileUrl }) }));
    mocks.probe.mockResolvedValueOnce(new Response(null, { status: 403 }));
    vi.spyOn(console, "warn").mockImplementationOnce(() => undefined);
    expect(await deliverMediaForPlatform("/uploads/ref/a.mp4", "seedance", arkVideoTarget, "video")).toEqual({ url: "https://oss.example/relay.png", via: "oss" });
    expect(mocks.fetch).toHaveBeenCalledOnce();
    expect(mocks.probe).toHaveBeenCalledTimes(failure === "link inaccessible" ? 1 : 0);
    expect(mocks.oss).toHaveBeenCalledWith("/uploads/ref/a.mp4", "seedance");
  });

  it("waits for an uploaded Ark video to become active and uses the link returned by the status check", async () => {
    mocks.fetch
      .mockResolvedValueOnce(json({ id: "file-ark-processing", status: "processing" }))
      .mockResolvedValueOnce(json({ id: "file-ark-processing", status: "active", download_url: arkFileUrl }));
    mocks.probe.mockResolvedValueOnce(new Response("x", { status: 206, headers: { "Content-Type": "application/octet-stream" } }));
    expect((await deliverMediaForPlatform("/uploads/ref/a.mp4", "seedance", arkVideoTarget, "video")).url).toBe(arkFileUrl);
    expect(mocks.fetch.mock.calls[1][1]).toBe("https://ark.cn-beijing.volces.com/api/v3/files/file-ark-processing");
    expect(mocks.probe).toHaveBeenCalledOnce();
  });

  it("skips Ark upload for an unsupported reference format and in forced OSS mode", async () => {
    vi.spyOn(console, "warn").mockImplementationOnce(() => undefined);
    expect((await deliverMediaForPlatform("/uploads/ref/a.webm", "seedance", arkVideoTarget, "video")).via).toBe("oss");
    process.env.MEDIA_DELIVERY_MODE = "oss";
    expect((await deliverMediaForPlatform("/uploads/ref/a.mp4", "seedance", arkVideoTarget, "video")).via).toBe("oss");
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.probe).not.toHaveBeenCalled();
  });

  it("sends Seedance MP3 as an inline audio data URL", async () => {
    fs.writeFileSync(path.join(uploadsRoot, "ref", "a.mp3"), "sample");
    const result = await deliverMediaForPlatform("/uploads/ref/a.mp3", "seedance", { platform: "volcengine" }, "audio");
    expect(result).toEqual({ url: "data:audio/mp3;base64,c2FtcGxl", via: "inline-base64" });
    expect(mocks.oss).not.toHaveBeenCalled();
  });

  it("sends MiniMax small MP4 inline, and uploads MOV as a video-generation file", async () => {
    const target = { platform: "minimax" };
    expect((await deliverMediaForPlatform("/uploads/ref/a.mp4", "minimax", target)).url).toMatch(/^data:video\/mp4;base64,/);
    fs.writeFileSync(path.join(uploadsRoot, "ref", "a.mov"), "sample");
    mocks.fetch.mockResolvedValueOnce(new Response('{"file":{"file_id":9223372036854775807},"base_resp":{"status_code":0}}'));
    expect(await deliverMediaForPlatform("/uploads/ref/a.mov", "minimax", target)).toEqual({
      url: "mm_file://9223372036854775807", via: "platform-upload",
    });
    const [, requestUrl, init] = mocks.fetch.mock.calls[0];
    expect(requestUrl).toBe("https://api.minimaxi.com/v1/files/upload");
    expect(init.body.get("purpose")).toBe("video_generation_input");
    expect(mocks.oss).not.toHaveBeenCalled();
  });
});

describe("fallback to Aliyun OSS without cross-provider borrowing", () => {
  it("preserves the OSS switch in desktop mode", async () => {
    vi.stubEnv("INKVIA_DESKTOP_MODE", "1");
    process.env.MEDIA_DELIVERY_MODE = "oss";
    expect(await deliverMediaForPlatform("/uploads/ref/a.mp4", "seedance", { platform: "minimax" }, "video")).toEqual({
      url: "https://oss.example/relay.png", via: "oss",
    });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("falls back directly to OSS when APIMart rejects an upload or its size limit is exceeded", async () => {
    const files = ["/uploads/ref/a.png", "/uploads/ref/big.png"];
    fs.writeFileSync(path.join(uploadsRoot, "ref", "big.png"), "");
    fs.truncateSync(path.join(uploadsRoot, "ref", "big.png"), 30 * 1024 * 1024 + 1);
    for (const [index, file] of files.entries()) {
      mocks.fetch.mockClear();
      if (index === 0) mocks.fetch.mockResolvedValueOnce(json({}, 402));
      vi.spyOn(console, "warn").mockImplementationOnce(() => undefined);
      expect(await deliverMediaForPlatform(file, "apimart", { platform: "apimart" })).toEqual({
        url: "https://oss.example/relay.png", via: "oss",
      });
      expect(mocks.fetch).toHaveBeenCalledTimes(index === 0 ? 1 : 0);
    }
    expect(mocks.oss).toHaveBeenCalledTimes(2);
  });

  it("uses OSS for other providers even when APIMart and KIE are configured", async () => {
    expect(await deliverMediaForPlatform("/uploads/ref/a.png", "other", { platform: "reapi" })).toEqual({
      url: "https://oss.example/relay.png", via: "oss",
    });
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.oss).toHaveBeenCalledOnce();
  });
});
