import { describe, expect, it } from "vitest";

import {
  PromptSegmentParseError,
  parsePromptSegmentsV1,
} from "@/lib/image-batch/prompt-segments";

describe("parsePromptSegmentsV1", () => {
  function expectParseError(raw: string, code: string) {
    try {
      parsePromptSegmentsV1(raw);
      throw new Error("expected parse to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(PromptSegmentParseError);
      expect(error).toMatchObject({ code });
    }
  }

  it("extracts task names and body-only prompts", () => {
    const raw = [
      "【猎奇反差｜提示词1】",
      "",
      "第一段第一行。",
      "",
      "第一段第二段落。",
      "",
      "【猎奇反差｜提示词2】",
      "第二段正文。",
    ].join("\n");

    expect(parsePromptSegmentsV1(raw)).toEqual([
      {
        index: 1,
        name: "猎奇反差｜提示词1",
        prompt: "第一段第一行。\n\n第一段第二段落。",
      },
      {
        index: 2,
        name: "猎奇反差｜提示词2",
        prompt: "第二段正文。",
      },
    ]);
  });

  it("accepts harmless V1 formatting differences", () => {
    const raw = "\ufeff```text\r\n### **（【猎奇反差 | 提示词 1】**\r\n正文一。）\r\n\r\n- __【猎奇反差｜提示词2】__\r\n正文二。\r\n```";
    expect(parsePromptSegmentsV1(raw)).toEqual([
      { index: 1, name: "猎奇反差｜提示词1", prompt: "正文一。" },
      { index: 2, name: "猎奇反差｜提示词2", prompt: "正文二。" },
    ]);
  });

  it("accepts descriptive two-part headings in document order", () => {
    const raw = [
      "【远景图｜普通家庭生活气息】",
      "远景正文。",
      "",
      "【1x中景图｜普通买家秀】",
      "中景正文。",
      "",
      "【0.5近景图｜脚仓前景生活抓拍】",
      "近景正文。",
      "",
      "【特写图｜屏幕与手臂气囊细节】",
      "特写正文。",
    ].join("\n");

    expect(parsePromptSegmentsV1(raw)).toEqual([
      { index: 1, name: "远景图｜普通家庭生活气息", prompt: "远景正文。" },
      { index: 2, name: "1x中景图｜普通买家秀", prompt: "中景正文。" },
      { index: 3, name: "0.5近景图｜脚仓前景生活抓拍", prompt: "近景正文。" },
      { index: 4, name: "特写图｜屏幕与手臂气囊细节", prompt: "特写正文。" },
    ]);
  });

  it("accepts single-part bracket headings in document order", () => {
    const raw = [
      "【远景图】",
      "远景第一行。",
      "远景第二行。",
      "",
      "[特写图]",
      "特写正文。",
    ].join("\n");

    expect(parsePromptSegmentsV1(raw)).toEqual([
      { index: 1, name: "远景图", prompt: "远景第一行。\n远景第二行。" },
      { index: 2, name: "特写图", prompt: "特写正文。" },
    ]);
  });

  it("accepts titleless prompts separated by non-empty lines", () => {
    const raw = [
      "普通家庭客厅中的按摩椅自然抓拍。",
      "人物进入零重力姿态，完整展示产品结构。",
      "近距离拍摄屏幕与手臂气囊细节。",
    ].join("\n");

    expect(parsePromptSegmentsV1(raw)).toEqual([
      { index: 1, name: "分段 1", prompt: "普通家庭客厅中的按摩椅自然抓拍。" },
      { index: 2, name: "分段 2", prompt: "人物进入零重力姿态，完整展示产品结构。" },
      { index: 3, name: "分段 3", prompt: "近距离拍摄屏幕与手臂气囊细节。" },
    ]);
  });

  it("keeps multi-line titleless blocks together when blank lines separate them", () => {
    const raw = [
      "第一段第一行。",
      "第一段第二行。",
      "",
      "第二段第一行。",
      "第二段第二行。",
    ].join("\n");

    expect(parsePromptSegmentsV1(raw)).toEqual([
      { index: 1, name: "分段 1", prompt: "第一段第一行。\n第一段第二行。" },
      { index: 2, name: "分段 2", prompt: "第二段第一行。\n第二段第二行。" },
    ]);
  });

  it("does not split bracket text embedded inside a body line", () => {
    const raw = "【测试｜提示词1】\n正文内保留【提示词说明】文字。";
    expect(parsePromptSegmentsV1(raw)[0]?.prompt).toBe(
      "正文内保留【提示词说明】文字。",
    );
  });

  it.each([
    ["正文前言\n【测试｜提示词1】\n正文", "PROMPT_SEGMENT_PREAMBLE"],
    ["【测试｜提示词2】\n正文", "PROMPT_SEGMENT_SEQUENCE"],
    ["【测试｜提示词1】\n正文\n【测试｜提示词3】\n正文", "PROMPT_SEGMENT_SEQUENCE"],
    ["【测试｜提示词1】\n", "PROMPT_SEGMENT_BODY_EMPTY"],
    ["【｜提示词1】\n正文", "PROMPT_SEGMENT_HEADER_INVALID"],
    ["【测试｜提示词A】\n正文", "PROMPT_SEGMENT_HEADER_INVALID"],
    ["   \n\n", "PROMPT_SEGMENTS_NOT_FOUND"],
  ])("rejects invalid input with %s", (raw, code) => {
    expectParseError(raw, code);
  });

  it("rejects more than the configured task limit", () => {
    const raw = Array.from(
      { length: 51 },
      (_, index) => `【测试｜提示词${index + 1}】\n正文${index + 1}`,
    ).join("\n");
    expectParseError(raw, "PROMPT_SEGMENT_LIMIT");
  });
});
