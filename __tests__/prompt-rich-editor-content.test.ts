import { describe, expect, it } from "vitest";
import * as promptContent from "@/lib/prompt-rich-editor-content";
import type { PromptReferenceAsset } from "@/lib/prompt-asset-references";

const { editorDocToPromptText, promptTextToEditorDoc } = promptContent;

const assets: PromptReferenceAsset[] = [
  { id: "img-1", token: "图片1", kind: "image", url: "/uploads/a.png", name: "a.png" },
  { id: "img-2", token: "图片2", kind: "image", url: "/uploads/b.png", name: "b.png" },
  { id: "video-1", token: "视频1", kind: "video", url: "/uploads/c.mp4", name: "c.mp4" },
  { id: "audio-1", token: "音频1", kind: "audio", url: "/uploads/d.mp3", name: "d.mp3" },
];

describe("prompt rich editor content", () => {
  it("finds the plain @ range for Backspace, Delete, and selected-text deletion", () => {
    const getPlainAtDeletionRange = (promptContent as any).getPlainAtDeletionRange;
    expect(getPlainAtDeletionRange).toBeTypeOf("function");

    const text = "x@";
    const textBetween = (from: number, to: number) => text.slice(from - 1, to - 1);

    expect(getPlainAtDeletionRange({
      key: "Backspace",
      selection: { empty: true, from: 3, to: 3 },
      textBetween,
    })).toEqual({ from: 2, to: 3 });
    expect(getPlainAtDeletionRange({
      key: "Delete",
      selection: { empty: true, from: 2, to: 2 },
      textBetween,
    })).toEqual({ from: 2, to: 3 });
    expect(getPlainAtDeletionRange({
      key: "Backspace",
      selection: { empty: false, from: 2, to: 3 },
      textBetween,
    })).toEqual({ from: 2, to: 3 });
    expect(getPlainAtDeletionRange({
      key: "Backspace",
      selection: { empty: true, from: 2, to: 2 },
      textBetween: () => "",
    })).toBeNull();
  });

  it("round trips plain text", () => {
    const doc = promptTextToEditorDoc("生成一张海报", assets);

    expect(editorDocToPromptText(doc)).toBe("生成一张海报");
  });

  it("converts known image, video, and audio mentions to atom nodes", () => {
    const doc = promptTextToEditorDoc("参考@图片1，运镜参考@视频1，声音参考@音频1", assets);
    const paragraph = doc.content[0];

    expect(paragraph.content?.map((node) => node.type)).toEqual([
      "text",
      "assetMention",
      "text",
      "assetMention",
      "text",
      "assetMention",
    ]);
    expect(editorDocToPromptText(doc)).toBe("参考@图片1，运镜参考@视频1，声音参考@音频1");
  });

  it("recognizes short image aliases without matching an unknown longer number", () => {
    const doc = promptTextToEditorDoc("@图1做人物，@图2做衣服，保留@图10", assets);
    expect(doc.content[0].content?.filter(node => node.type === "assetMention").map(node => node.attrs?.assetId)).toEqual(["img-1", "img-2"]);
    expect(editorDocToPromptText(doc)).toBe("@图片1做人物，@图片2做衣服，保留@图10");
  });

  it("keeps stale mentions as plain text", () => {
    const doc = promptTextToEditorDoc("参考@图片9生成", assets);

    expect(doc.content[0].content?.map((node) => node.type)).toEqual(["text"]);
    expect(editorDocToPromptText(doc)).toBe("参考@图片9生成");
  });

  it("does not turn an unknown two-digit reference into a one-digit asset tag", () => {
    const doc = promptTextToEditorDoc("参考@图片10和@视频12生成", assets);
    expect(doc.content[0].content?.every((node) => node.type === "text")).toBe(true);
    expect(editorDocToPromptText(doc)).toBe("参考@图片10和@视频12生成");
  });

  it("round trips repeated and mixed mentions", () => {
    const prompt = "先看@图片2，再参考@图片2，最后参考@视频1";
    const doc = promptTextToEditorDoc(prompt, assets);

    expect(editorDocToPromptText(doc)).toBe(prompt);
  });

  it("preserves hard breaks", () => {
    const prompt = "第一行@图片1\n第二行@视频1";
    const doc = promptTextToEditorDoc(prompt, assets);

    expect(editorDocToPromptText(doc)).toBe(prompt);
  });

  it.each(["\r\n", "\r", "\n"])("treats %j as one line break with or without asset mentions", (newline) => {
    const expected = "第一行@图片1\n第二行@视频1\n第三行";
    for (const references of [[], assets]) {
      const doc = promptTextToEditorDoc(expected.replaceAll("\n", newline), references);

      expect(editorDocToPromptText(doc)).toBe(expected);
      expect(doc.content[0].content?.filter((node) => node.type === "hardBreak")).toHaveLength(2);
      expect(doc.content[0].content?.some((node) => node.text?.includes("\r"))).toBe(false);
    }
  });

  it("preserves intentional blank lines and surrounding whitespace when normalizing Windows line endings", () => {
    const doc = promptTextToEditorDoc("\r\n  第一行@图片1\r\n\r\n第二行  \r\n", assets);

    expect(editorDocToPromptText(doc)).toBe("\n  第一行@图片1\n\n第二行  \n");
    expect(doc.content[0].content?.filter((node) => node.type === "hardBreak")).toHaveLength(4);
  });

  it("keeps the selected skill as the first inline reference without serializing it into prompt text", () => {
    const doc = promptTextToEditorDoc("参考@图片1生成", assets, {
      id: "system:1",
      name: "卖家秀",
    });

    expect(doc.content[0].content?.map((node) => node.type)).toEqual([
      "roleSkillMention",
      "text",
      "assetMention",
      "text",
    ]);
    expect(doc.content[0].content?.[0].attrs).toEqual({
      skillId: "system:1",
      name: "卖家秀",
    });
    expect(editorDocToPromptText(doc)).toBe("参考@图片1生成");
  });

  it("removes deleted asset mentions and keeps surviving references attached after reindexing", () => {
    const reconcilePromptAssetMentions = (promptContent as any).reconcilePromptAssetMentions;
    expect(reconcilePromptAssetMentions).toBeTypeOf("function");
    const doc = promptTextToEditorDoc("保留@图片1，删除@图片2", assets);
    const nextAssets: PromptReferenceAsset[] = [
      { ...assets[1], token: "图片1" },
    ];

    const reconciled = reconcilePromptAssetMentions(doc, nextAssets);

    expect(editorDocToPromptText(reconciled)).toBe("保留，删除@图片1");
  });

  it("does not resurrect a deleted mention when a similarly numbered asset is uploaded later", () => {
    const reconcilePromptAssetMentions = (promptContent as any).reconcilePromptAssetMentions;
    expect(reconcilePromptAssetMentions).toBeTypeOf("function");
    const doc = promptTextToEditorDoc("参考@图片1生成", assets);
    const afterDelete = reconcilePromptAssetMentions(doc, []);
    const afterReupload = promptTextToEditorDoc(
      editorDocToPromptText(afterDelete),
      [{ id: "new-image", token: "图片1", kind: "image", url: "/uploads/new.png" }],
    );

    expect(editorDocToPromptText(afterReupload)).toBe("参考生成");
    expect(afterReupload.content[0].content?.map((node) => node.type)).toEqual(["text"]);
  });

  it("strips every supported asset reference from regenerated prompts", () => {
    const stripPromptAssetMentions = (promptContent as any).stripPromptAssetMentions;
    expect(stripPromptAssetMentions).toBeTypeOf("function");

    expect(stripPromptAssetMentions("参考@图片1、@视频2、@音频1和@人像1生成"))
      .toBe("参考、、和生成");
  });
});

