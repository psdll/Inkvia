import { describe, expect, it } from "vitest";
import {
  EMPTY_CANVAS_VOICE_FILTERS,
  filterCanvasVoices,
  inferCanvasVoiceMetadata,
  paginateCanvasVoices,
  paginationItems,
  type CanvasMiniMaxVoice,
} from "@/lib/canvas/minimax-voice-library";

const voices: CanvasMiniMaxVoice[] = [
  {
    id: "male-qn-qingse",
    name: "青涩青年音色",
    description: "中文普通话男声",
    source: "system",
    language: "zh",
    accent: "mandarin",
    gender: "male",
    age: "youth",
  },
  {
    id: "female-shaonv",
    name: "少女音色",
    description: "中文普通话女声",
    source: "system",
    language: "zh",
    accent: "mandarin",
    gender: "female",
    age: "youth",
  },
  {
    id: "CanvasVoice_1700000000000_ab12cd34",
    name: "我的克隆音色",
    description: "",
    source: "cloned",
    gender: "unknown",
    age: "unknown",
  },
];

describe("canvas MiniMax voice library", () => {
  it("infers only deterministic metadata and leaves uncertain fields unknown", () => {
    expect(
      inferCanvasVoiceMetadata({
        id: "male-qn-qingse",
        name: "青涩青年音色",
        description: "中文普通话男声",
        source: "system",
      }),
    ).toMatchObject({
      language: "zh",
      accent: "mandarin",
      gender: "male",
      age: "youth",
    });
    expect(
      inferCanvasVoiceMetadata({
        id: "account-voice-1",
        name: "自定义",
        description: "",
        source: "cloned",
      }),
    ).toMatchObject({ gender: "unknown", age: "unknown" });
  });

  it("always assigns a displayable language when MiniMax omits language metadata", () => {
    expect(
      inferCanvasVoiceMetadata({
        id: "少女音色-beta",
        name: "少女音色-beta",
        description: "",
        source: "system",
      }).language,
    ).toBe("zh");
    expect(
      inferCanvasVoiceMetadata({
        id: "voice-001",
        name: "Trustworthy Man",
        description: "可信稳重的男声",
        source: "system",
      }).language,
    ).toBe("en");
    expect(
      inferCanvasVoiceMetadata({
        id: "account-voice-1",
        name: "My voice",
        description: "",
        source: "cloned",
      }).language,
    ).toBe("multi");
    expect(
      inferCanvasVoiceMetadata({
        id: "Turkish_Trustworthyman",
        name: "Trustworthy man",
        description: "一位富有磁性的土耳其语声音",
        source: "system",
      }).language,
    ).toBe("tr");
    expect(
      inferCanvasVoiceMetadata({
        id: "Cantonese_Kind_Woman",
        name: "Kind Woman",
        description: "温柔粤语女声",
        source: "system",
      }).language,
    ).toBe("yue");
  });

  it("composes tab, search, favorite, and applied filters", () => {
    expect(
      filterCanvasVoices({
        voices,
        tab: "system",
        query: "少女",
        favoriteIds: new Set(["female-shaonv"]),
        filters: { ...EMPTY_CANVAS_VOICE_FILTERS, gender: ["female"] },
      }).map((voice) => voice.id),
    ).toEqual(["female-shaonv"]);
    expect(
      filterCanvasVoices({
        voices,
        tab: "mine",
        query: "",
        favoriteIds: new Set(),
        filters: EMPTY_CANVAS_VOICE_FILTERS,
      }).map((voice) => voice.id),
    ).toEqual(["CanvasVoice_1700000000000_ab12cd34"]);
    expect(
      filterCanvasVoices({
        voices,
        tab: "favorites",
        query: "",
        favoriteIds: new Set(["male-qn-qingse"]),
        filters: EMPTY_CANVAS_VOICE_FILTERS,
      }).map((voice) => voice.id),
    ).toEqual(["male-qn-qingse"]);
  });

  it("clamps pages and builds compact page items", () => {
    expect(paginateCanvasVoices(voices, 99, 2)).toMatchObject({
      page: 2,
      pageCount: 2,
      total: 3,
      items: [voices[2]],
    });
    expect(paginationItems(1, 17)).toEqual([
      1,
      2,
      3,
      4,
      5,
      "ellipsis",
      17,
    ]);
    expect(paginationItems(9, 17)).toEqual([
      1,
      "ellipsis",
      7,
      8,
      9,
      10,
      11,
      "ellipsis",
      17,
    ]);
    expect(paginationItems(17, 17)).toEqual([
      1,
      "ellipsis",
      13,
      14,
      15,
      16,
      17,
    ]);
  });
});
