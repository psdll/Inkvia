import { openAiChatAdapter } from "./openai-chat";
import { anthropicMessagesAdapter } from "./anthropic-messages";
import type { LlmProtocol, LlmProtocolAdapter } from "./types";

const ADAPTERS = new Map<LlmProtocol, LlmProtocolAdapter>([
  [openAiChatAdapter.protocol, openAiChatAdapter],
  [anthropicMessagesAdapter.protocol, anthropicMessagesAdapter],
]);

export function getLlmProtocolAdapter(protocol: LlmProtocol): LlmProtocolAdapter | null {
  return ADAPTERS.get(protocol) ?? null;
}

export function hasLlmProtocolAdapter(protocol: unknown): protocol is LlmProtocol {
  return typeof protocol === "string" && ADAPTERS.has(protocol as LlmProtocol);
}
