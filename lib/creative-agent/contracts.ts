import type { CanvasDocumentV2 } from "@/lib/canvas/document";
import type { CreativeAgentUsage, CreativeAgentUsageScopes } from "./usage";

export const CREATIVE_AGENT_PROTOCOL_VERSION = 1 as const;
export type CreativeAgentRunStatus = "queued" | "running" | "waiting_decision" | "waiting_action" | "paused" | "stopping" | "completed" | "stopped" | "failed";
export type CreativeAgentReference = {
  canvasId: number;
  nodeId: string;
  label: string;
  kind: string;
  batchId?: string;
  outputId?: string;
  mediaId?: string;
  generationId?: number;
  semanticHash?: string;
  purpose?: "identity" | "scene" | "style" | "composition" | "content";
};
export type CreativeAgentSelection = { nodeIds: string[]; edgeIds: string[]; references: CreativeAgentReference[] };
export type CreativeAgentCanvasContext = { canvasId: number; revision: string; selection: CreativeAgentSelection };
export type CreativeAgentBoardSnapshot = { document: CanvasDocumentV2; selection: CreativeAgentSelection };
export type CreativeAgentBoardBridge = {
  getSnapshot(): CreativeAgentBoardSnapshot;
  flush(): void;
  applyRemote(document: CanvasDocumentV2): { conflicts: string[] };
  /** outputIndex：多图节点里第几张（从 0 开始，按生成顺序）；画布会聚焦并临时显示这一张 */
  focus(nodeId: string, target?: { outputIndex?: number }): void;
};
export type CreativeAgentThinking = { content: string; duration?: number; streaming?: boolean };
export type CreativeAgentMessage = { selectedSkillId?: string | null; thinking?: CreativeAgentThinking; id: string; role: "user" | "assistant"; text: string; createdAt: string; runId?: string; references?: CreativeAgentReference[] };
export type CreativeAgentRun = { id: string; sessionId: string; canvasId: number; status: CreativeAgentRunStatus; error?: string | null; createdAt: string; updatedAt: string };
export type CreativeAgentMedia = {
  generationId: number; runId: string; status: string; mediaType: "image" | "video";
  model: string; nodeIds: string[]; createdAt: string; error?: string;
  /** Agent v3：版本名，如“特写暖调版” */
  title?: string;
  retryOfGenerationId?: number; retryAttempt?: 1; retryReason?: string;
  outputs: { url: string; nodeId?: string; generationId?: number; width?: number; height?: number }[];
  review?: { status: "running" | "completed" | "unavailable"; message?: string };
};
export type CreativeAgentEventType = "message.revised" | "media.updated" | "media.review" | "usage.updated" | "text.delta" | "thinking.delta" | "thinking.completed" | "message.completed" | "tool.started" | "tool.completed" | "canvas.committed" | "decision.requested" | "run.status" | "error";
export type CreativeAgentEvent = { sequence: number; runId: string; type: CreativeAgentEventType; payload: Record<string, unknown>; createdAt: string };
export type CreativeAgentSessionSummary = { activeSkillId?: string | null; id: string; title: string; titleSource: "auto" | "manual"; titleMessageId: string | null; lastMessageId: string | null; messageCount: number; createdAt: string; updatedAt: string };
export type CreativeAgentSessionSnapshot = { editableMessageId?: string | null; finishedAtByRun?: Record<string, string>; media?: CreativeAgentMedia[]; mediaPending?: boolean; usage?: CreativeAgentUsage; usageScopes?: CreativeAgentUsageScopes; activity?: { event: CreativeAgentEvent; run: CreativeAgentRun }[]; session?: CreativeAgentSessionSummary | null; sessionId: string | null; messages: CreativeAgentMessage[]; run: CreativeAgentRun | null; latestSequence: number };
export type CreativeAgentCapabilities = { protocolVersion: 1; enabled: boolean; ready: boolean; reason: string | null };
export type CreativeAgentInputOptions = { selectedSkillId?: string | null; referenceMode?: "replace" | "clear" | "combine"; model?: { providerId: string; modelId: string }; thinkingLevel?: import("@/lib/llm-routing/reasoning").LlmThinkingInput; attachments?: { id: string }[]; preferences?: import("./preferences").CreativeAgentPreferences };
export type CreativeAgentAttachment = { id: string; name: string; mimeType: string; size: number; status: "ready"; coverage: string };
export type CreativeAgentMessageInput = CreativeAgentInputOptions & { messageId: string; sessionId?: string; text: string; baseRevision: string; selection: CreativeAgentSelection };
export type CreativeAgentControl = { requestId: string; action: "pause" | "stop" | "resume" | "continue" };
export type CreativeAgentMessageRevision = { runId: string; messageId: string; requestId: string; text: string; expectedText: string };
export type CreativeAgentEventsResponse = { editableMessageId?: string | null; events: CreativeAgentEvent[]; nextSequence: number; run: CreativeAgentRun; media?: CreativeAgentMedia[]; mediaPending?: boolean };

export function isCreativeAgentRunActive(status: CreativeAgentRunStatus): boolean {
  return !["completed", "stopped", "failed"].includes(status);
}
