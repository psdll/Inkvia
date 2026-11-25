import type { ProviderProtocol } from "./types";

type ModelFetchProvider = {
  id: string;
  protocol: ProviderProtocol;
};

const MODEL_FETCH_UNSUPPORTED_IDS = new Set([
  "work-fisher", // No documented model-list API; use the builtin capability.
  "kie",
  "jiekou",
  "volcengine",
  "volcengine-speech",
  "volcengine-mediakit",
  "google-ai-studio",
  "reapi",
  "runninghub",
  "bigmodel", // No verified model-list contract; use the two builtin capabilities.
]);

export function supportsProviderModelFetch(provider: ModelFetchProvider): boolean {
  if (MODEL_FETCH_UNSUPPORTED_IDS.has(provider.id)) return false;
  return provider.protocol === "openai"
    || provider.protocol === "apimart"
    || provider.protocol === "volcengine";
}
