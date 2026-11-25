import type { ResolvedProvider } from "@/lib/providers/types";
import type { ProviderEgressDecision } from "@/lib/providers/transport";
import type { LlmProtocol } from "./adapters/types";

export type LlmScenarioId = "canvas.chat" | "image.role_prompt" | "agent.chat";
export type LlmRouteSource = "configured" | "node-override";
export type LlmRouteStatus =
  | "ready"
  | "missing-binding"
  | "provider-disabled"
  | "missing-key"
  | "missing-proxy"
  | "invalid-proxy"
  | "model-disabled"
  | "unsupported-capability"
  | "unsupported-protocol"
  | "invalid-endpoint";

export type LlmRouteBinding = { providerId: string; modelId: string; networkRevision?: string };

export type LlmScenario = {
  id: LlmScenarioId;
  label: string;
  settingKey: string;
  allowOverride: boolean;
  visual: boolean;
  timeoutMs: number;
  logAction: "llm_call_canvas_chat" | "llm_call_image_role_prompt" | "llm_call_agent_chat";
};

export type ResolvedLlmRoute = {
  scenarioId: LlmScenarioId;
  providerId: string;
  providerName: string;
  modelId: string;
  protocol: LlmProtocol;
  source: LlmRouteSource;
  status: "ready";
  url: string;
  apiKey: string;
  timeoutMs: number;
  /** Server-only, immutable network snapshot used by executable routes. */
  egressDecision?: Readonly<ProviderEgressDecision>;
};

/** Safe route details that may cross a server boundary. */
export type LlmRouteSnapshot = Pick<
  ResolvedLlmRoute,
  "scenarioId" | "providerId" | "providerName" | "modelId" | "protocol" | "source" | "status"
>;

export type LlmRouteResult =
  | { status: "ready"; route: ResolvedLlmRoute }
  | { status: Exclude<LlmRouteStatus, "ready"> };

export type LlmChatMessage = {
  role: "system" | "user" | "assistant";
  content: unknown;
};

export type LlmUsage = {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  cachedInputTokens?: number;
  cacheCreationInputTokens?: number;
  reasoningOutputTokens?: number;
};
export type LlmOutputLimit = { tokens: number; parameter: "max_tokens" | "max_completion_tokens" };

export type RuntimeLlmProvider = ResolvedProvider & { enabled: boolean; sortOrder: number };
