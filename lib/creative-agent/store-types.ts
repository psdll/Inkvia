import type { TurnRequirements } from "./matching-contracts";
import type { CreativeAgentPreferences } from "./preferences";
import { createHash } from "node:crypto";
import type { QuestionField } from "./questions";
import type { CreativeAgentSelection, CreativeAgentMessage, CreativeAgentInputOptions } from "./contracts";
import type { CreativeAgentMediaPresentation } from "./media-presentation";

export type RunStatus = "queued" | "running" | "waiting_decision" | "waiting_action" | "paused" | "stopping" | "completed" | "stopped" | "failed";
export type Selection = CreativeAgentSelection;
export type Run = {
  id: string; sessionId: string; actorUserId: number; canvasId: number; status: RunStatus;
  epoch: number; error: string | null; createdAt: string; updatedAt: string;
  leaseExpiresAt: string | null; workerId: string | null; input: MessageInput;
};
export type ModelFrontier = {
  version: 1; sessionId: string; messageId: string; revision: number;
  userMarkerHash: string; contextHash: string; providerId: string; modelId: string; controlsHash: string;
};
export const modelFrontierHash = (scope: { actorUserId: number; canvasId: number; runId: string }, frontier: ModelFrontier) =>
  hash({ actorUserId: scope.actorUserId, canvasId: scope.canvasId, runId: scope.runId, ...frontier });
export type MessageInput = CreativeAgentInputOptions & { /** 3 = Agent v3 编排 */ engine?: 3; conversationContext?: import("./conversation-context").ConversationContext; modelFrontiers?: Record<string, { actionId: string; inputHash: string }>; mediaAuthorizationVersion?: 1; generationPlans?: Record<string, import("./quantity").SavedGenerationPlan>; quantityLedger?: import("./quantity").GenerationQuantityLedger; revision?: number; revisionStartEpoch?: number; /** Agent v3 继续执行：工具动作沿用的版本号，已提交的生成可复用 */ actionRevision?: number; matchingPolicyVersion?: 2; effectivePreferences?: CreativeAgentPreferences; requirements?: TurnRequirements; actorUserId: number; canvasId: number; messageId: string; sessionId?: string; text: string; baseRevision: string; selection: Selection; resolvedSelection?: Selection; preparedSelection?: Selection };
export type Message = CreativeAgentMessage & { runId: string };
export type EventType = import("./contracts").CreativeAgentEventType;
export type Event = { sequence: number; runId: string; type: EventType; payload: Record<string, unknown>; createdAt: string };
export type ActionState = "claimed" | "succeeded" | "failed" | "unknown";
export type Action = { id: string; actionId: string; actorUserId: number; canvasId: number; runId: string; epoch: number; kind: string; inputHash: string; state: ActionState; result: unknown; claimed: boolean };
export type DecisionBinding = { kind: string; argsHash: string; units: number; retryLimit?: number; version?: 2 } & Partial<import("./quantity").GenerationExecution>;
export type DecisionPrompt = { title: string; question: string; options: { value: string; label: string }[]; fields?: QuestionField[]; binding?: DecisionBinding; media?: CreativeAgentMediaPresentation };
export type Decision = DecisionPrompt & { id: string; runId: string; actionId: string; proposalHash: string; state: "pending" | "answered" | "cancelled"; answer: unknown };

export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
export function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  return `{${entries.map(([key, val]) => `${JSON.stringify(key)}:${canonical(val)}`).join(",")}}`;
}
export const hash = (value: unknown) => createHash("sha256").update(canonical(value)).digest("hex");

export const isTerminal = (status: RunStatus) => ["completed", "stopped", "failed"].includes(status);
