import sharp from "sharp";
import { animatedGifFixture } from "./helpers/animated-gif";
import { Readable } from "node:stream";
import { readFileSync } from "node:fs";
import fs from "fs-extra";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/runtime-isolation", async () => ({ ...await vi.importActual("@/lib/runtime-isolation"), assertWritablePath: (await import("./helpers/fixture-storage-boundary")).assertFixtureStoragePath }));

const mocks = vi.hoisted(() => ({
  directAxios: vi.fn(),
  providerAxios: vi.fn(),
}));

vi.mock("@/lib/providers/transport", () => ({
  directAxios: mocks.directAxios,
  providerAxios: mocks.providerAxios,
}));

import { dedupeImageUrlsByContent } from "@/lib/image-edit-helpers";
import { saveRemoteFile, saveRemoteFileWithHash } from "@/lib/storage";

function streamResponse(body: string, contentType = "image/png") {
  return {
    data: Readable.from([Buffer.from(body)]),
    headers: { "content-type": contentType },
  };
}

async function listFiles(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(fullPath));
    else files.push(fullPath);
  }
  return files;
}

describe("provider result download egress", () => {
  let uploadsDir = "";

  beforeEach(async () => {
    vi.clearAllMocks();
    uploadsDir = await fs.mkdtemp(path.join(os.tmpdir(), "provider-result-egress-"));
    process.env.UPLOADS_DIR = uploadsDir;
  });

  afterEach(async () => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete process.env.UPLOADS_DIR;
    delete process.env.HTTPS_PROXY;
    if (uploadsDir) await fs.remove(uploadsDir);
  });

  it("preserves every GIF frame through both provider storage paths", async () => {
    const gif = await animatedGifFixture();
    mocks.providerAxios.mockImplementation(async () => ({ data: Readable.from([gif]), headers: { "content-type": "image/gif" } }));
    const apimart = await saveRemoteFileWithHash("https://cdn.example.test/animated.gif", "image_results", false, { providerId: "apimart" });
    const openrouter = await saveRemoteFile(`data:image/gif;base64,${gif.toString("base64")}`, "image_results", true, { providerId: "openrouter" });
    for (const result of [apimart.localPath, openrouter]) {
      expect(result).toMatch(/\.gif$/);
      const bytes = await fs.readFile(path.join(uploadsDir, result.replace(/^\/uploads\//, "")));
      expect(bytes).toEqual(gif);
      expect(await sharp(bytes, { animated: true }).metadata()).toMatchObject({ format: "gif", pages: 2, pageHeight: 16, delay: [200, 200] });
    }
  });

  it("downloads a provider result through providerAxios with media semantics", async () => {
    mocks.providerAxios.mockResolvedValue(streamResponse("provider-image"));

    const localPath = await saveRemoteFile(
      "https://cdn.example.test/output.png",
      "image_results",
      false,
      { providerId: "apimart" },
    );

    expect(localPath).toMatch(/^\/uploads\/image_results\//);
    expect(mocks.providerAxios).toHaveBeenCalledWith(
      "apimart",
      expect.objectContaining({
        url: "https://cdn.example.test/output.png",
        method: "GET",
        responseType: "stream",
        timeout: 30_000,
      }),
      { purpose: "media" },
    );
    expect(mocks.directAxios).not.toHaveBeenCalled();
  });

  it("reuses a stable remote audio file until that file is deleted", async () => {
    mocks.providerAxios.mockResolvedValue(
      streamResponse("preview-audio", "audio/mpeg"),
    );
    const options = {
      providerId: "minimax",
      stableKey: "1234567890abcdef1234567890abcdef",
      dateSubdirectory: false,
      fallbackExt: "mp3",
    };

    const first = await saveRemoteFile(
      "https://cdn.example.test/preview.bin",
      "canvas_voice_previews",
      false,
      options,
    );
    const second = await saveRemoteFile(
      "https://cdn.example.test/preview.bin",
      "canvas_voice_previews",
      false,
      options,
    );

    expect(first).toBe(
      "/uploads/canvas_voice_previews/1234567890abcdef1234567890abcdef.mp3",
    );
    expect(second).toBe(first);
    expect(mocks.providerAxios).toHaveBeenCalledTimes(1);

    await fs.remove(
      path.join(
        uploadsDir,
        "canvas_voice_previews",
        "1234567890abcdef1234567890abcdef.mp3",
      ),
    );
    await saveRemoteFile(
      "https://cdn.example.test/preview.bin",
      "canvas_voice_previews",
      false,
      options,
    );
    expect(mocks.providerAxios).toHaveBeenCalledTimes(2);
  });

  it("forces generic remote imports to direct Axios even when proxy env vars exist", async () => {
    process.env.HTTPS_PROXY = "http://trap.invalid:8080";
    mocks.directAxios.mockResolvedValue(streamResponse("direct-image"));

    await saveRemoteFile("https://user.example.test/input.png", "imports");

    expect(mocks.directAxios).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://user.example.test/input.png",
        maxRedirects: 3,
      }),
      { purpose: "media" },
    );
    expect(mocks.providerAxios).not.toHaveBeenCalled();
    delete process.env.HTTPS_PROXY;
  });

  it("keeps streaming hash downloads on the selected provider egress", async () => {
    mocks.providerAxios.mockResolvedValue(streamResponse("same-content", "video/mp4"));

    const saved = await saveRemoteFileWithHash(
      "https://cdn.example.test/output.mp4",
      "video_results",
      false,
      { providerId: "volcengine" },
    );

    expect(saved.bytes).toBe(Buffer.byteLength("same-content"));
    expect(saved.hash).toHaveLength(64);
    expect(mocks.providerAxios).toHaveBeenCalledWith(
      "volcengine",
      expect.objectContaining({ responseType: "stream" }),
      { purpose: "media" },
    );
  });

  it("keeps retry and temporary-file cleanup behavior for interrupted provider streams", async () => {
    vi.spyOn(globalThis, "setTimeout").mockImplementation(((handler: () => void) => {
      queueMicrotask(handler);
      return 0 as unknown as NodeJS.Timeout;
    }) as typeof setTimeout);
    const interrupted = new Readable({
      read() {
        this.push(Buffer.from("partial"));
        this.destroy(new Error("interrupted"));
      },
    });
    mocks.providerAxios
      .mockResolvedValueOnce({ data: interrupted, headers: { "content-type": "video/mp4" } })
      .mockResolvedValueOnce(streamResponse("complete", "video/mp4"));

    const pending = saveRemoteFileWithHash(
      "https://cdn.example.test/retry.mp4",
      "video_results",
      false,
      { providerId: "kie" },
    );
    const saved = await pending;

    expect(saved.bytes).toBe(Buffer.byteLength("complete"));
    expect(mocks.providerAxios).toHaveBeenCalledTimes(2);
    expect((await listFiles(uploadsDir)).some((file) => file.endsWith(".part"))).toBe(false);
  });

  it.each([
    ["saveRemoteFile", saveRemoteFile],
    ["saveRemoteFileWithHash", saveRemoteFileWithHash],
  ])("labels exhausted %s provider downloads as result-save failures", async (_label, save) => {
    vi.spyOn(globalThis, "setTimeout").mockImplementation(((handler: () => void) => {
      queueMicrotask(handler);
      return 0 as unknown as NodeJS.Timeout;
    }) as typeof setTimeout);
    const timeout = Object.assign(new Error("Provider request failed (ETIMEDOUT)"), {
      code: "ETIMEDOUT",
    });
    mocks.providerAxios.mockRejectedValue(timeout);

    await expect(save(
      "https://cdn.example.test/timeout.png",
      "image_results",
      false,
      { providerId: "kie" },
    )).rejects.toThrow("远程结果已返回，但下载保存失败（ETIMEDOUT）");
    expect(mocks.providerAxios).toHaveBeenCalledTimes(5);
  });

  it("uses the provider egress while hashing Seedream result URLs for deduplication", async () => {
    mocks.providerAxios
      .mockResolvedValueOnce({ data: Buffer.from("same") })
      .mockResolvedValueOnce({ data: Buffer.from("same") });

    const urls = await dedupeImageUrlsByContent(
      ["https://a.example.test/one.png", "https://b.example.test/two.png"],
      "volcengine",
    );

    expect(urls).toEqual(["https://a.example.test/one.png"]);
    expect(mocks.providerAxios).toHaveBeenCalledTimes(2);
    expect(mocks.providerAxios).toHaveBeenNthCalledWith(
      1,
      "volcengine",
      expect.objectContaining({ responseType: "arraybuffer" }),
      { purpose: "media" },
    );
    expect(mocks.directAxios).not.toHaveBeenCalled();
  });
});

describe("provider result egress propagation", () => {
  it("passes the persisted generation provider into every finalizer download", () => {
    const source = readFileSync(
      path.resolve(process.cwd(), "lib/generation/finalize.ts"),
      "utf8",
    ).replace(/\r\n/g, "\n");

    const downloads = [...source.matchAll(/saveRemoteFileWithHash\(\s*(url|suno!\.coverUrl!|outcome\.lastFrameUrl)\s*,\s*outputFolder\s*,\s*(?:\/\^data:\/i\.test\(url\)|false)\s*,\s*\{ providerId: provider \}/g)];
    expect(downloads.map((match) => match[1])).toEqual(["url", "suno!.coverUrl!", "outcome.lastFrameUrl"]);
    expect(source).toMatch(
      /saveRemoteFileWithHash\(\s*outcome\.lastFrameUrl,\s*outputFolder,\s*false,/,
    );
  });

  it("keeps synchronous image result downloads bound to the server-selected adapter", () => {
    const source = readFileSync(path.resolve(process.cwd(), "lib/generation/image-service.ts"), "utf8");

    expect(source).toContain('{ providerId: input.externalProvider }');
    expect(source).toContain('dedupeImageUrlsByContent(seedream.urls, "volcengine")');
    for (const providerId of ["google-ai-studio", "jiekou", "volcengine"]) {
      expect(source).toContain(`{ providerId: "${providerId}" }`);
    }
  });

  it("derives image error-log providers from the toolbox model registry", () => {
    const source = readFileSync(path.resolve(process.cwd(), "lib/generation/image-service.ts"), "utf8");

    expect(source).toContain("IMAGE_EDIT_MODEL_DEFINITIONS.find((item) => item.id === model)?.provider");
    expect(source).not.toContain('model.includes("nano-banana")');
    expect(source).not.toContain('model.includes("gpt-image-2")');
  });


});
