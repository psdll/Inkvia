export const QWEN_38_MAX_MODEL_ID = "qwen3.8-max";
export const BAILIAN_LLM_MODELS = [QWEN_38_MAX_MODEL_ID, "qwen3.8-flash", "qwen3.8-omni-flash"] as const;

// https://help.aliyun.com/en/model-studio/qwen-api-via-openai-chat-completions
// Accept the same saved workspace URL forms as the existing Wan integration.
export function resolveBailianLlmBaseUrl(baseUrl: string): string {
  const value = baseUrl.trim();
  if (!value || /[{}<>]/.test(value)) throw new Error("Invalid Bailian base URL");
  const url = new URL(value);
  const path = url.pathname.replace(/\/+$/, "");
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash
    || !["", "/api/v1", "/compatible-mode/v1", "/api/v1/services/aigc/video-generation/video-synthesis"].includes(path)) {
    throw new Error("Invalid Bailian base URL");
  }
  return `${url.origin}/compatible-mode/v1`;
}
