import type { ProviderConfig, ResolvedProvider } from "@/lib/providers/types";
import { resolveReapiLlmBaseUrl } from "@/lib/reapi-llm-models";
import { resolveBailianLlmBaseUrl } from "@/lib/bailian-llm-models";
import { resolveVolcengineLlmBaseUrl } from "@/lib/volcengine-llm-models";
import { resolveBigModelLlmBaseUrl } from "@/lib/bigmodel-llm-models";

type EndpointProvider = Pick<
  ProviderConfig | ResolvedProvider,
  "id" | "protocol" | "baseUrl" | "llmProtocol" | "llmEndpointTemplate"
>;
type DefaultEndpointProvider = Pick<EndpointProvider, "id" | "protocol">;

export type LlmEndpointResult =
  | { ok: true; url: string }
  | { ok: false; reason: "unsupported-protocol" | "invalid-endpoint" };

export function getDefaultLlmEndpointTemplate(provider: DefaultEndpointProvider): string | null {
  if (["volcengine-speech", "volcengine-mediakit"].includes(provider.id)) return null;
  if (provider.id === "kie") return "{model}/v1/chat/completions";
  if (provider.protocol === "openai" || provider.protocol === "apimart" || provider.protocol === "volcengine") {
    return "chat/completions";
  }
  return null;
}

function containsEncodedTraversal(template: string): boolean {
  let decoded = template;
  for (let index = 0; index < 2; index += 1) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    } catch {
      return true;
    }
  }
  return decoded.split(/[\\/]/).includes("..");
}

export function resolveLlmEndpoint(provider: EndpointProvider, modelId: string): LlmEndpointResult {
  if (provider.llmProtocol && provider.llmProtocol !== "openai-chat") {
    return { ok: false, reason: "unsupported-protocol" };
  }
  const defaultTemplate = getDefaultLlmEndpointTemplate(provider);
  if (provider.llmProtocol !== "openai-chat" && defaultTemplate === null) {
    return { ok: false, reason: "unsupported-protocol" };
  }
  const template = provider.llmEndpointTemplate?.trim() || defaultTemplate;
  if (!template) return { ok: false, reason: "unsupported-protocol" };
  if (
    !provider.baseUrl?.trim() ||
    /^\w+:\/\//.test(template) ||
    template.startsWith("/") ||
    containsEncodedTraversal(template) ||
    /\{(?!model\})[^}]*\}/.test(template) ||
    /[?#]/.test(template)
  ) {
    return { ok: false, reason: "invalid-endpoint" };
  }

  const path = template.replaceAll("{model}", encodeURIComponent(modelId));
  try {
    const baseUrl = provider.id === "reapi"
      ? resolveReapiLlmBaseUrl(provider.baseUrl, modelId)
      : provider.id === "bailian" ? resolveBailianLlmBaseUrl(provider.baseUrl)
      : provider.id === "bigmodel" && template === "chat/completions" ? resolveBigModelLlmBaseUrl(provider.baseUrl)
      : provider.id === "volcengine" && template === "chat/completions" ? resolveVolcengineLlmBaseUrl(provider.baseUrl) : provider.baseUrl;
    const base = new URL(baseUrl);
    if (!/^https?:$/.test(base.protocol)) return { ok: false, reason: "invalid-endpoint" };
    return {
      ok: true,
      url: `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`,
    };
  } catch {
    return { ok: false, reason: "invalid-endpoint" };
  }
}
