import { describe, expect, it } from "vitest";
import { buildPromptWithAssetReferences } from "@/lib/prompt-asset-references";

const assets = [
  { id: "a", token: "图片1", kind: "image" as const, url: "/uploads/a.png", name: "a.png" },
  { id: "b", token: "图片2", kind: "image" as const, url: "/uploads/b.png", name: "b.png" },
  { id: "c", token: "视频1", kind: "video" as const, url: "/uploads/c.mp4", name: "c.mp4" },
  { id: "d", token: "音频1", kind: "audio" as const, url: "/uploads/d.mp3", name: "d.mp3" },
];

describe("buildPromptWithAssetReferences", () => {
  it("matches complete multi-digit asset numbers while preserving reference order", () => {
    const image10 = { ...assets[0], id: "ten", token: "图片10" };
    const result = buildPromptWithAssetReferences("参考@图片10，再参考@图片1和@图片10", [...assets, image10], { format: "seedance25_mentions" });
    expect(result.refs.map((ref) => ref.id)).toEqual(["a", "ten"]);
    expect(result.modelPrompt).toBe("参考@image10，再参考@image1和@image10");
  });

  it("leaves unknown numbers sharing a known prefix untouched", () => {
    const result = buildPromptWithAssetReferences("参考@图片10和@视频12生成", assets, { format: "ordinal" });
    expect(result.mentioned).toBe(false);
    expect(result.refs).toEqual([]);
    expect(result.modelPrompt).toBe("参考@图片10和@视频12生成");
  });

  it("leaves prompts unchanged when no asset mention is used", () => {
    const result = buildPromptWithAssetReferences("参考图片2的风格", assets);

    expect(result.mentioned).toBe(false);
    expect(result.modelPrompt).toBe("参考图片2的风格");
    expect(result.refs).toEqual([]);
  });

  it("adds a reference map when an asset mention is used", () => {
    const result = buildPromptWithAssetReferences("参考@图片2的产品主体，镜头参考@视频1", assets);

    expect(result.mentioned).toBe(true);
    expect(result.modelPrompt).toContain("下面是参考素材编号，编号与本次请求中传入的素材顺序一致：");
    expect(result.modelPrompt).toContain("图片1：第1张输入参考图");
    expect(result.modelPrompt).toContain("图片2：第2张输入参考图");
    expect(result.modelPrompt).toContain("视频1：第1个输入参考视频");
    expect(result.modelPrompt).toContain("用户需求：\n参考图片2的产品主体，镜头参考视频1");
    expect(result.refs.map((ref) => ref.token)).toEqual(["图片2", "视频1"]);
  });

  it("uses ordinal references without the custom map when requested", () => {
    const result = buildPromptWithAssetReferences(
      "参考@图片2的产品主体，镜头参考@视频1",
      assets,
      { format: "ordinal" },
    );

    expect(result.mentioned).toBe(true);
    expect(result.modelPrompt).toBe("参考图片2的产品主体，镜头参考视频1");
    expect(result.modelPrompt).not.toContain("下面是参考素材编号");
    expect(result.modelPrompt).not.toContain("用户需求：");
    expect(result.refs.map((ref) => ref.token)).toEqual(["图片2", "视频1"]);
  });

  it("uses official Seedance 2.5 mentions without a custom map", () => {
    const result = buildPromptWithAssetReferences(
      "以@图片2为主体，参考@视频1的动作和@音频1的节奏，再次保持@图片2一致",
      assets,
      { format: "seedance25_mentions" },
    );

    expect(result.mentioned).toBe(true);
    expect(result.modelPrompt).toBe(
      "以@image2为主体，参考@video1的动作和@audio1的节奏，再次保持@image2一致",
    );
    expect(result.modelPrompt).not.toContain("下面是参考素材编号");
    expect(result.modelPrompt).not.toContain("用户需求：");
    expect(result.refs.map((ref) => ref.token)).toEqual(["图片2", "视频1", "音频1"]);
  });

  it("keeps a Seedance 2.5 prompt unchanged when it has no valid mention", () => {
    const result = buildPromptWithAssetReferences(
      "生成一段高端按摩椅商业广告",
      assets,
      { format: "seedance25_mentions" },
    );

    expect(result.mentioned).toBe(false);
    expect(result.modelPrompt).toBe("生成一段高端按摩椅商业广告");
    expect(result.refs).toEqual([]);
  });

  it("ignores stale mentions without blocking the original prompt", () => {
    const result = buildPromptWithAssetReferences("参考@图片9生成", assets);

    expect(result.mentioned).toBe(false);
    expect(result.modelPrompt).toBe("参考@图片9生成");
  });
});
