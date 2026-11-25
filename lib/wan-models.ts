export const WAN_VIDEO_MODEL_ID = "wan3.0-video" as const;
export const WAN_PROVIDER_ID = "bailian" as const;

export function isWanVideoModel(model: string): boolean {
  return String(model || "").trim() === WAN_VIDEO_MODEL_ID;
}

export const WAN_VIDEO_RATIOS = ["adaptive", "16:9", "4:3", "1:1", "3:4", "9:16"];

// Beijing public list prices; account discounts are configurable in admin pricing.
export const WAN_VIDEO_DEFAULT_PRICE_RULES = [
  { resolution: "480p", unitPrice: 0.3 },
  { resolution: "720p", unitPrice: 0.6 },
  { resolution: "1080p", unitPrice: 1.2 },
].map(({ resolution, unitPrice }) => ({
  provider: WAN_PROVIDER_ID,
  model: WAN_VIDEO_MODEL_ID,
  displayName: "Wan3.0",
  module: "video" as const,
  unitType: "second" as const,
  unitPrice,
  currency: "CNY" as const,
  priority: 50,
  matchConditions: { resolution },
  notes: "百炼北京公开标价：输入视频秒数 + 输出视频秒数；音频开关不改变价格。限时折扣及账户优惠请按实际账单调整。",
}));
