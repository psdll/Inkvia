import {
  MINIMAX_H3_MAX_MODEL_ID,
  MINIMAX_H3_MODEL_ID,
  MINIMAX_PROVIDER_ID,
} from "@/lib/minimax-models";

type MiniMaxPriceRule = {
  provider: "minimax";
  model: string;
  displayName: string;
  module: "video";
  unitType: "second";
  unitPrice: number;
  currency: "CNY";
  priority: number;
  matchConditions: { resolution: string };
  notes: string;
};

export const MINIMAX_H3_FREE_IMAGE_COUNT = 5;
export const MINIMAX_H3_EXCESS_IMAGE_PRICE = 0.2;

export const MINIMAX_H3_DEFAULT_PRICE_RULES: MiniMaxPriceRule[] = [
  { resolution: "768p", unitPrice: 0.5 },
  { resolution: "2k", unitPrice: 0.8 },
].map(({ resolution, unitPrice }) => ({
  provider: MINIMAX_PROVIDER_ID,
  model: MINIMAX_H3_MODEL_ID,
  displayName: "MiniMax-H3",
  module: "video",
  unitType: "second",
  unitPrice,
  currency: "CNY",
  priority: 50,
  matchConditions: { resolution },
  notes: "MiniMax 官方按量计费：输出视频按秒；输入视频按同分辨率单价；前 5 张输入图片免费，超出部分 0.20 元/张；音频免费。",
}));

export const MINIMAX_H3_MAX_DEFAULT_PRICE_RULES: MiniMaxPriceRule[] = [
  { resolution: "480p", unitPrice: 0.33 },
  { resolution: "768p", unitPrice: 0.5 },
].map(({ resolution, unitPrice }) => ({
  provider: MINIMAX_PROVIDER_ID,
  model: MINIMAX_H3_MAX_MODEL_ID,
  displayName: "MiniMax-H3-Max",
  module: "video",
  unitType: "second",
  unitPrice,
  currency: "CNY",
  priority: 50,
  matchConditions: { resolution },
  notes: "MiniMax 官方按量计费：输出视频按秒；输入图片暂不计费。",
}));
