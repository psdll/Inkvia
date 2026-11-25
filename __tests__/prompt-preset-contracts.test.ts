import {
  mergeCanvasPromptContent,
  normalizePromptInput,
  parsePromptPublicId,
  toPromptPublicId,
} from "@/lib/prompt-presets/contracts";
import { describe, expect, it } from "vitest";

describe("prompt preset contracts", () => {
  it("requires a non-empty category", () => {
    expect(() =>
      normalizePromptInput({ name: "人像精修", category: "  ", content: "正文" }),
    ).toThrow("分类不能为空");
  });

  it("keeps a user-defined category", () => {
    expect(
      normalizePromptInput({
        name: "人像精修",
        category: "我的电商修图",
        content: "正文",
      }).category,
    ).toBe("我的电商修图");
  });

  it("trims required prompt fields and enforces their length limits", () => {
    expect(
      normalizePromptInput({ name: " 人像精修 ", category: " 人像 ", content: " 正文 " }),
    ).toEqual({ name: "人像精修", category: "人像", content: "正文" });

    expect(() =>
      normalizePromptInput({ name: "n".repeat(129), category: "人像", content: "正文" }),
    ).toThrow();
    expect(() =>
      normalizePromptInput({ name: "人像", category: "c".repeat(65), content: "正文" }),
    ).toThrow();
    expect(() =>
      normalizePromptInput({ name: "人像", category: "人像", content: "x".repeat(10_001) }),
    ).toThrow();
  });

  it("rejects reserved and empty prompt fields", () => {
    expect(() =>
      normalizePromptInput({ name: "", category: "人像", content: "正文" }),
    ).toThrow();
    expect(() =>
      normalizePromptInput({ name: "人像", category: "all", content: "正文" }),
    ).toThrow();
    expect(() =>
      normalizePromptInput({ name: "人像", category: "人像", content: "" }),
    ).toThrow();
  });

  it("merges canvas positive and negative into one content", () => {
    expect(mergeCanvasPromptContent("正向", "负向")).toBe(
      "正向\n\n负向提示词：负向",
    );
    expect(mergeCanvasPromptContent("正向", "")).toBe("正向");
  });

  it("rejects canvas content with only a negative prompt", () => {
    expect(() => mergeCanvasPromptContent("", "负向")).toThrow();
  });

  it("round-trips source-prefixed public ids", () => {
    expect(parsePromptPublicId(toPromptPublicId("builtin", BigInt(12)))).toEqual({
      source: "builtin",
      id: BigInt(12),
    });
  });

  it("rejects invalid public id prefixes and bigint values", () => {
    expect(() => parsePromptPublicId("external:12")).toThrow();
    expect(() => parsePromptPublicId("builtin:not-a-bigint")).toThrow();
    expect(() => parsePromptPublicId("builtin:0")).toThrow();
    expect(() => toPromptPublicId("builtin", BigInt(0))).toThrow();
  });
});
