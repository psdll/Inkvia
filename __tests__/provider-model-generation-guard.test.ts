import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string) => {
  const absolutePath = join(root, path);
  return existsSync(absolutePath) ? readFileSync(absolutePath, "utf8") : "";
};

describe("provider model generation guards", () => {
  const imageService = read("lib/generation/image-service.ts");
  const videoService = read("lib/generation/video-service.ts");

  it("rejects unselected image and video models before calling an upstream adapter", () => {
    expect(imageService).toContain('isProviderModelEnabled(providers, "image", model)');
    expect(videoService).toContain('isProviderModelEnabled(providers, "video", model)');
    expect(imageService).toContain("当前图片生成模型未在平台配置中启用");
    expect(videoService).toContain("当前视频生成模型未在平台配置中启用");
  });

  it("uses the default image model only when no explicit model was selected", async () => {
    const module = await import("@/lib/generation/image-service");
    const resolveImageGenerationModel = (module as Record<string, unknown>)
      .resolveImageGenerationModel as undefined | ((
        selectedModel: unknown,
        defaultModel: string,
        knownModels: ReadonlySet<string>,
      ) => string);

    expect(typeof resolveImageGenerationModel).toBe("function");
    expect(resolveImageGenerationModel?.("", "nano-banana-pro", new Set(["known-model"])))
      .toBe("nano-banana-pro");
    expect(resolveImageGenerationModel?.("known-model", "nano-banana-pro", new Set(["known-model"])))
      .toBe("known-model");
    expect(() => resolveImageGenerationModel?.(
      "future-model",
      "nano-banana-pro",
      new Set(["known-model"]),
    )).toThrow("请更换模型");
  });
});
