import type { ResolvedProvider } from "@/lib/providers/types";
import type { LlmThinkingInput } from "../reasoning";
import type { LlmEndpointResult } from "../endpoint";
import type { LlmChatMessage, ResolvedLlmRoute, LlmUsage, LlmOutputLimit } from "../types";

export type LlmProtocol =
  | "openai-chat"
  | "openai-responses"
  | "anthropic-messages"
  | "gemini-generate-content";

export type LlmAdapterFailure = {
  kind: "upstream" | "unsupported-image" | "invalid-response" | "media-download";
  message: string;
  status?: number;
};

export type LlmProtocolAdapter = {
  protocol: LlmProtocol;
  resolveEndpoint(provider: ResolvedProvider, modelId: string): LlmEndpointResult;
  buildRequest(route: ResolvedLlmRoute, messages: LlmChatMessage[], outputLimit?: LlmOutputLimit, stream?: boolean, thinkingLevel?: LlmThinkingInput): { url: string; init: RequestInit };
  readUsage?(payload: unknown): LlmUsage | null;
  parseSuccess(payload: unknown, status: number):
    | { ok: true; text: string }
    | { ok: false; failure: LlmAdapterFailure };
  classifyFailure(payload: unknown, status: number): LlmAdapterFailure;
};
