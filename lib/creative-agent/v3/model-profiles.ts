/**
 * 智能匹配用的模型画像。
 *
 * speed 取自本项目 Generation 表近 45 天成功任务的耗时中位数（秒），
 * reliability 为同期成功率；strengths 是创作向的擅长方向。
 * 目录里出现但这里没有画像的模型按通用模型处理，仍可被手动选择。
 */
export type ImageStrength = "text" | "edit" | "photo" | "product" | "art" | "general";
export type VideoStrength = "general" | "cinematic" | "person" | "product" | "motion";

export type ImageModelProfile = {
  speed: number;
  reliability: number;
  tier: "fast" | "standard" | "pro";
  strengths: ImageStrength[];
  /** 给 Agent 看的一句话定位 */
  note: string;
  /** 不支持参考图编辑 */
  textOnly?: boolean;
};
export type VideoModelProfile = {
  speed: number;
  reliability: number;
  tier: "fast" | "standard" | "pro";
  strengths: VideoStrength[];
  note: string;
};

export const IMAGE_MODEL_PROFILES: Record<string, ImageModelProfile> = {
  "gpt-image-2.5-flare-openrouter": { speed: 22, reliability: 0.9, tier: "fast", strengths: ["text", "general", "product"], note: "出图最快，文字排版准，适合一次出多个方向" },
  "gemini-nano-banana-2.1": { speed: 28, reliability: 0.8, tier: "fast", strengths: ["edit", "photo", "general"], note: "快速改图、多图融合" },
  "gemini-3-pro-image": { speed: 43, reliability: 0.96, tier: "standard", strengths: ["edit", "text", "photo", "product", "general"], note: "综合质量高，改图能保持主体一致，中文文字好" },
  "gpt-image-2-openrouter": { speed: 51, reliability: 1, tier: "standard", strengths: ["text", "general"], note: "指令遵循强，文字排版准" },
  "gpt-image-2.5-sunburst-openrouter": { speed: 53, reliability: 0.97, tier: "pro", strengths: ["text", "product", "photo"], note: "精修级画质，细节与文字最好" },
  "doubao-seedream-5.0-pro": { speed: 59, reliability: 1, tier: "pro", strengths: ["text", "photo", "product"], note: "中文文字与商业摄影质感好，偏慢" },
  "midjourney-v8-apimart": { speed: 90, reliability: 0.88, tier: "standard", strengths: ["art"], note: "艺术、插画、概念风格，每次固定出 4 张，提示词末尾可加 --s、--raw、--hd 等参数", textOnly: true },
};

export const VIDEO_MODEL_PROFILES: Record<string, VideoModelProfile> = {
  "doubao-seedance-2.0-face": { speed: 324, reliability: 1, tier: "fast", strengths: ["general", "person", "product"], note: "效果稳、出片最快（约5分钟）" },
  "seedance-2.5-apimart": { speed: 441, reliability: 1, tier: "pro", strengths: ["cinematic", "motion", "general"], note: "画质与动作表现最好，较慢" },
  "wan3.0-video": { speed: 700, reliability: 1, tier: "standard", strengths: ["general", "motion"], note: "时长可到30秒，较慢" },
  "minimax-h3": { speed: 860, reliability: 1, tier: "standard", strengths: ["general", "person"], note: "人物表现好，很慢" },
  "minimax-h3-max": { speed: 900, reliability: 1, tier: "pro", strengths: ["cinematic", "person"], note: "高质量，很慢" },
};

const fallbackImage: ImageModelProfile = { speed: 60, reliability: 0.9, tier: "standard", strengths: ["general"], note: "通用图片模型" };
const fallbackVideo: VideoModelProfile = { speed: 600, reliability: 0.9, tier: "standard", strengths: ["general"], note: "通用视频模型" };

export const imageProfile = (id: string) => IMAGE_MODEL_PROFILES[id] ?? fallbackImage;

/** 每次请求固定产出的图片张数（上游接口规定，如 Midjourney 一次出 4 张）；未列出的为 1 */
export const IMAGE_OUTPUTS_PER_REQUEST: Record<string, number> = { "midjourney-v8-apimart": 4, "midjourney-v8-reapi": 4 };
export const imageOutputsPerRequest = (id: string) => IMAGE_OUTPUTS_PER_REQUEST[id] ?? 1;
export const videoProfile = (id: string) => VIDEO_MODEL_PROFILES[id] ?? fallbackVideo;

/** 约 X 秒 / 约 X 分钟 */
export function etaLabel(seconds: number) {
  return seconds < 90 ? `约 ${Math.max(10, Math.round(seconds / 5) * 5)} 秒` : `约 ${Math.max(1, Math.round(seconds / 60))} 分钟`;
}

/**
 * 对话模型的上下文窗口（tokens）。来源：模型卡 / 部署文档；Doubao-Seed-Evolving 官方文档未查到，按第三方评测的 1M 记。
 * 部署时可用环境变量 INKVIA_AGENT_CONTEXT_LIMITS={"模型ID":{"contextWindow":数值}} 覆盖。
 */
export const CHAT_CONTEXT_WINDOWS: Record<string, number> = {
  "doubao-seed-evolving": 1_000_000,
  "MiniMax-M3": 1_048_576,
  "glm-5.3-flash": 1_048_576,
};

/** token 数的简写：1,048,576 → 1M，113,141 → 113k，18,295 → 18.3k */
export function formatTokens(value: number) {
  const short = (number: number, unit: string) => `${number >= 100 ? Math.round(number) : Number(number.toFixed(1))}${unit}`;
  if (value >= 1_000_000) return short(value / 1_000_000, "M");
  if (value >= 1_000) return short(value / 1_000, "k");
  return String(Math.round(value));
}
