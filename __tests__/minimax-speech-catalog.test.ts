import { describe, expect, it } from "vitest";
import {
  MINIMAX_SPEECH_HD_MODEL_ID,
  MINIMAX_SPEECH_TURBO_MODEL_ID,
} from "@/lib/minimax-speech-models";
import { MINIMAX_SPEECH_DEFAULT_PRICE_RULES } from "@/lib/minimax-speech-pricing";
import { getBuiltinProviders } from "@/lib/providers/registry";
import { AUDIO_MODEL_DEFINITIONS } from "@/lib/toolbox-models";

describe("MiniMax speech 2.8 catalog", () => {
  it("registers only the two requested audio models on the official provider", () => {
    expect(AUDIO_MODEL_DEFINITIONS.filter((model) => model.provider === "minimax")).toEqual([
      expect.objectContaining({
        id: MINIMAX_SPEECH_HD_MODEL_ID,
        label: "Minimax-speech-2.8-hd",
        provider: "minimax",
        category: "audio",
      }),
      expect.objectContaining({
        id: MINIMAX_SPEECH_TURBO_MODEL_ID,
        label: "Minimax-speech-2.8-turbo",
        provider: "minimax",
        category: "audio",
      }),
    ]);

    expect(getBuiltinProviders().find((provider) => provider.id === "minimax")?.audioModels)
      .toEqual([MINIMAX_SPEECH_HD_MODEL_ID, MINIMAX_SPEECH_TURBO_MODEL_ID]);

    expect(MINIMAX_SPEECH_DEFAULT_PRICE_RULES).toEqual([
      expect.objectContaining({ model: MINIMAX_SPEECH_HD_MODEL_ID, unitType: "ten_thousand_character", unitPrice: 3.5 }),
      expect.objectContaining({ model: MINIMAX_SPEECH_TURBO_MODEL_ID, unitType: "ten_thousand_character", unitPrice: 2 }),
    ]);
  });
});
