import {
  MINIMAX_SPEECH_HD_MODEL_ID,
  MINIMAX_SPEECH_TURBO_MODEL_ID,
} from "@/lib/minimax-speech-models";

type MiniMaxSpeechPriceRule = {
  provider: "minimax";
  model: string;
  displayName: string;
  module: "audio";
  unitType: "ten_thousand_character";
  unitPrice: number;
  currency: "CNY";
  priority: number;
  matchConditions: null;
  notes: string;
};

export const MINIMAX_SPEECH_DEFAULT_PRICE_RULES: MiniMaxSpeechPriceRule[] = [
  {
    provider: "minimax",
    model: MINIMAX_SPEECH_HD_MODEL_ID,
    displayName: "MiniMax speech-2.8-hd",
    module: "audio",
    unitType: "ten_thousand_character",
    unitPrice: 3.5,
    currency: "CNY",
    priority: 50,
    matchConditions: null,
    notes: "MiniMax 官方按量计费：3.5 元/万字符。",
  },
  {
    provider: "minimax",
    model: MINIMAX_SPEECH_TURBO_MODEL_ID,
    displayName: "MiniMax speech-2.8-turbo",
    module: "audio",
    unitType: "ten_thousand_character",
    unitPrice: 2,
    currency: "CNY",
    priority: 50,
    matchConditions: null,
    notes: "MiniMax 官方按量计费：2 元/万字符。",
  },
];
