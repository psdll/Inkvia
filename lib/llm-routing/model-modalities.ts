import { getReapiLlmModelRule } from "@/lib/reapi-llm-models";
import { VOLC_ASR_MODEL_ID } from "@/lib/volcengine-asr-models";
import { SEED_AUDIO_MODEL_ID } from "@/lib/seed-audio-models";
import { MINIMAX_SPEECH_HD_MODEL_ID, MINIMAX_SPEECH_TURBO_MODEL_ID } from "@/lib/minimax-speech-models";

export type LlmModality = "text" | "image" | "audio" | "video";
type Modalities = { input: readonly LlmModality[]; output: readonly LlmModality[] };

// Official model capabilities, checked 2026-09-21. These describe the model,
// not which upload controls are available in each product screen.
// https://help.aliyun.com/zh/model-studio/qwen3-8-{max,flash,27b,omni-flash}
// Bailian entries rechecked 2026-09-23; Omni Flash outputs text, not audio.
// https://www.minimax.io/blog/minimax-m3
const MODEL_INPUTS: Record<string, readonly LlmModality[]> = {
  // BigModel exact-model documentation, checked 2026-10-15.
  "glm-5.3": ["text"],
  "glm-5.3-flash": ["text", "image", "video"],
  // https://docs.volcengine.com/docs/ark/model-list (checked 2026-10-12)
  "doubao-seed-evolving": ["text", "image", "video"],
  // OpenAI official model pages, checked 2026-09-23. Image input only;
  // image-generation tools do not make these LLMs image-output models.
  // https://developers.openai.com/api/docs/models/gpt-5.5
  "gpt-5.5": ["text", "image"],
  // User-confirmed GPT-5.5 variant (2026-09-23); same display capabilities.
  "gpt-5.5-high": ["text", "image"],
  // https://developers.openai.com/api/docs/models/gpt-5.6-terra
  "gpt-5.6-terra": ["text", "image"],
  // https://developers.openai.com/api/docs/models/gpt-5.6-sol
  "gpt-5.6-sol": ["text", "image"],
  "qwen3.8-max": ["text", "image", "video"],
  "qwen3.8-flash": ["text", "image", "video"],
  "qwen3.8-27b": ["text", "image", "video"],
  "qwen3.8-omni-flash": ["text", "image", "audio", "video"],
  "MiniMax-M3": ["text", "image", "video"],
  // https://platform.minimax.cn/docs/guides/text-generation (checked 2026-10-21)
  "MiniMax-M3.1-Flash": ["text", "image", "video"],
  // https://api-docs.deepseek.com/quick_start/pricing/ (checked 2026-09-23)
  // deepseek-flash and the legacy Flash IDs now serve DeepSeek-V4.1-Flash.
  "deepseek-flash": ["text", "image"],
  "deepseek-v4.1-flash": ["text", "image"],
  "deepseek-v4-flash": ["text", "image"],
  "deepseek-v4-flash-vision-exp": ["text", "image"],
  "deepseek-v4-pro": ["text"],
};

export function getLlmModelModalities(_providerId: string, modelId: string): Modalities | null {
  // https://docs.volcengine.com/docs/DoubaoVoice/audio-generation-http?lang=zh
  // Checked 2026-09-23. Image and audio references cannot be combined.
  if (modelId === SEED_AUDIO_MODEL_ID) return { input: ["text", "image", "audio"], output: ["audio"] };
  // 录音文件识别：音频（视频先抽出音轨）转文字
  if (modelId === VOLC_ASR_MODEL_ID) return { input: ["audio", "video"], output: ["text"] };
  // https://platform.minimax.cn/docs/api-reference/api-overview (checked 2026-09-23)
  // Speech synthesis takes text and returns audio; voice cloning is a separate API.
  if (modelId === MINIMAX_SPEECH_HD_MODEL_ID || modelId === MINIMAX_SPEECH_TURBO_MODEL_ID) {
    return { input: ["text"], output: ["audio"] };
  }
  // Display policy: the same model uses the same modalities on every platform.
  // Prefer official references; otherwise reuse an existing platform reference.
  // Match exact IDs only (including documented or user-confirmed aliases); never guess.
  const input = Object.prototype.hasOwnProperty.call(MODEL_INPUTS, modelId) ? MODEL_INPUTS[modelId] : undefined;
  if (input) return { input, output: ["text"] };
  const rule = getReapiLlmModelRule(modelId);
  if (rule && typeof rule.vision === "boolean") {
    return { input: rule.vision ? ["text", "image"] : ["text"], output: ["text"] };
  }
  return null;
}
