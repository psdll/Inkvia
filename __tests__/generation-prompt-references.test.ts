import { describe, expect, it } from "vitest";
import { buildGenerationPrompt, type GenerationPromptMedia } from "@/lib/generation/prompt-references";
import { IMAGE_EDIT_MODEL_DEFINITIONS, VIDEO_MODEL_DEFINITIONS } from "@/lib/toolbox-models";

const media: GenerationPromptMedia[] = [
  { kind: "image", url: "/b.png" },
  { kind: "video", url: "/clip.mp4" },
  { kind: "image", url: "/a.png" },
  { kind: "audio", url: "/sound.mp3" },
];
const ordinalVideoModels = new Set([
  "doubao-seedance-2-0-260128", "doubao-seedance-2-0-fast-260128", "doubao-seedance-2-0-mini-260615",
  "doubao-seedance-2.0-face", "doubao-seedance-2.0-fast-face",
  "minimax-h3", "minimax-h3-max",
]);

describe("project-wide generation reference policy", () => {
  it.each(IMAGE_EDIT_MODEL_DEFINITIONS.map((model) => model.id))("uses creation-page image rules for %s", (model) => {
    const images = media.filter((asset) => asset.kind === "image");
    const result = buildGenerationPrompt({ kind: "image", model, media: images, prompt: "@图片2 参考 @图片1" });
    expect(result.modelPrompt).toBe("图片2 参考 图片1");
    expect(result.refs.map((asset) => asset.url)).toEqual(["/b.png", "/a.png"]);
    expect(buildGenerationPrompt({ kind: "image", model, media: images, prompt: "生成产品图" }).modelPrompt).toBe("生成产品图");
  });

  it.each(VIDEO_MODEL_DEFINITIONS.map((model) => model.id))("uses creation-page video rules for %s", (model) => {
    const result = buildGenerationPrompt({ kind: "video", model, media, prompt: "@图片2 参考 @视频1 配 @音频1" });
    if (model === "doubao-seedance-2-5-260628") {
      expect(result.modelPrompt).toBe("@image2 参考 @video1 配 @audio1");
    } else if (model === "seedance-2.5-apimart") {
      expect(result.modelPrompt).toBe("@图片2 参考 @视频1 配 @音频1");
    } else if (model === "wan3.0-video") {
      expect(result.modelPrompt).toBe("图2 参考 视频1 配 音频1");
    } else if (ordinalVideoModels.has(model)) {
      expect(result.modelPrompt).toBe("图片2 参考 视频1 配 音频1");
    } else {
      expect(result.modelPrompt).toBe("下面是参考素材编号，编号与本次请求中传入的素材顺序一致：\n图片1：第1张输入参考图\n视频1：第1个输入参考视频\n图片2：第2张输入参考图\n音频1：第1段输入参考音频\n\n用户需求：\n图片2 参考 视频1 配 音频1");
    }
    expect(buildGenerationPrompt({ kind: "video", model, media, prompt: "生成产品视频" }).modelPrompt).toBe("生成产品视频");
  });

  it("retains no-mention and previously compiled prompts without adding another mapping", () => {
    for (const model of ["doubao-seedance-2-5-260628", "doubao-seedance-1-5-pro-251215", "minimax-h3"]) {
      const first = buildGenerationPrompt({ kind: "video", model, media, prompt: "@图片2 在 @视频1 中出现" });
      expect(buildGenerationPrompt({ kind: "video", model, media, prompt: first.modelPrompt }).modelPrompt).toBe(first.modelPrompt);
      expect(buildGenerationPrompt({ kind: "video", model, media: [], prompt: "原文 @图片10" }).modelPrompt).toBe("原文 @图片10");
    }
  });

  it("matches complete multi-digit references without changing unmatched mentions", () => {
    const assets: GenerationPromptMedia[] = Array.from({ length: 12 }, (_, i) => ({ kind: "image", url: `/image-${i}.png` }));
    const result = buildGenerationPrompt({ kind: "video", model: "doubao-seedance-2.0-face", media: assets, prompt: "使用 @图片12 和 @图片1，@图片123 保留" });
    expect(result.modelPrompt).toBe("使用 图片12 和 图片1，@图片123 保留");
    expect(result.refs.map((asset) => asset.token)).toEqual(["图片1", "图片12"]);
  });

  it("gives new pages and models the shared default without a page-specific branch", () => {
    expect(buildGenerationPrompt({ kind: "image", model: "future-image-model", media, prompt: "@图片2" }).modelPrompt).toBe("图片2");
    expect(buildGenerationPrompt({ kind: "video", model: "future-video-model", media, prompt: "@图片2" }).modelPrompt).toContain("图片2：第2张输入参考图");
  });
});
