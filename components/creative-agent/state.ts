import { creativeToolFailurePresentation } from "@/lib/creative-agent/tool-presentation";
import { friendlyErrorDisplayText } from "@/lib/error-friendly";
import { isCreativeAgentRunActive } from "@/lib/creative-agent/contracts";
import type { CreativeAgentUsage, CreativeAgentUsageScopes } from "@/lib/creative-agent/usage";
import type { QuestionField } from "@/lib/creative-agent/questions";
import type {
  CreativeAgentEvent,
  CreativeAgentMessage,
  CreativeAgentRun,
  CreativeAgentSessionSnapshot,
  CreativeAgentMedia,
} from "@/lib/creative-agent/contracts";

export type AgentTool = {
  activity?: import("@/lib/creative-agent/tool-presentation").CreativeToolActivity;
  startedSequence?: number;
  id: string;
  name?: string;
  runId?: string;
  createdAt?: string;
  title: string;
  detail?: string;
  status: "running" | "completed" | "failed";
  progress?: number;
  canUndo?: boolean;
  outcomeLabel?: string;
  decision?: { title: string; question: string; answer: string; skipped?: boolean; items?: { question: string; answer: string }[]; media?: import("@/lib/creative-agent/media-presentation").CreativeAgentMediaPresentation };
  nodeIds: string[];
};
export type AgentDecision = {
  id: string;
  proposalHash: string;
  title: string;
  question: string;
  options: { value: string; label: string }[];
  fields?: QuestionField[];
  expiresAt?: string;
  media?: import("@/lib/creative-agent/media-presentation").CreativeAgentMediaPresentation;
};
export type AgentViewState = {
  editableMessageId?: string | null;
  finishedAtByRun?: Record<string, string>;
  media: CreativeAgentMedia[];
  mediaPending?: boolean;
  sessionId: string | null;
  messages: CreativeAgentMessage[];
  completedIds: string[];
  run: CreativeAgentRun | null;
  sequence: number;
  actualModel?: string;
  usage?: CreativeAgentUsage;
  usageScopes?: CreativeAgentUsageScopes;
  usageSequence?: number;
  thinkingLabel?: string;
  tools: AgentTool[];
  decision: AgentDecision | null;
  error: string | null;
};
export const emptyAgentState = (): AgentViewState => ({
  media: [],
  sessionId: null,
  messages: [],
  completedIds: [],
  run: null,
  sequence: 0,
  tools: [],
  decision: null,
  error: null,
});
const str = (value: unknown) => (typeof value === "string" ? value : "");

export function restoreAgentSnapshot(
  snapshot: CreativeAgentSessionSnapshot,
): AgentViewState {
  // Re-read the active run's event log to recover pending tool/decision cards.
  // Snapshot messages are authoritative and must not receive their old deltas again.
  let state: AgentViewState = {
    ...emptyAgentState(),
    ...snapshot,
    usageSequence: snapshot.latestSequence,
    sequence: 0,
    completedIds: snapshot.messages
      .filter((message) => message.role === "assistant")
      .map((message) => message.id),
  };
  if (snapshot.run && !isCreativeAgentRunActive(snapshot.run.status)) state.finishedAtByRun = { ...state.finishedAtByRun, [snapshot.run.id]: snapshot.run.updatedAt };
  for (const activity of snapshot.activity || []) {
    if (activity.run.id !== snapshot.run?.id) state = applyAgentEvents({ ...state, sequence: 0 }, [activity.event], activity.run);
  }
  return { ...state, run: snapshot.run, sequence: 0, decision: null };
}

export function applyAgentEvents(
  state: AgentViewState,
  events: CreativeAgentEvent[],
  run: CreativeAgentRun,
): AgentViewState {
  let next: AgentViewState = { ...state, run };
  for (const event of [...events].sort((a, b) => a.sequence - b.sequence)) {
    if (event.runId !== run.id || event.sequence <= next.sequence) continue;
    next = { ...next, sequence: event.sequence };
    const p = event.payload;
    if (event.type === "message.revised") {
      const message = p.message as CreativeAgentMessage;
      const removed = new Set(next.messages.filter(item => item.runId === run.id).map(item => item.id));
      next.messages = [...next.messages.filter(item => item.runId !== run.id), message];
      next.completedIds = next.completedIds.filter(id => !removed.has(id));
      next.tools = next.tools.filter(tool => tool.runId !== run.id);
      next.decision = null;
      next.error = null;
      next.thinkingLabel = undefined;
      next.actualModel = undefined;
      next.usage = p.usage as CreativeAgentUsage | undefined;
      next.usageSequence = event.sequence;
    } else if (event.type === "media.updated") {
      const media = { ...p, runId: event.runId, createdAt: str(p.createdAt) || event.createdAt } as CreativeAgentMedia;
      if (Number.isSafeInteger(media.generationId) && Array.isArray(media.outputs)) {
        next.media = [...(next.media || []).filter(item => item.generationId !== media.generationId), media];
      }
    } else if (event.type === "media.review") {
      next.media = (next.media || []).map(item => item.runId === event.runId ? { ...item, review: p as CreativeAgentMedia["review"] } : item);
    } else if (event.type === "usage.updated") {
      if (event.sequence > (next.usageSequence ?? 0) && p.usage && typeof p.usage === "object") {
        next.usage = p.usage as CreativeAgentUsage;
        if (p.usageScopes && typeof p.usageScopes === "object") next.usageScopes = p.usageScopes as CreativeAgentUsageScopes;
        next.usageSequence = event.sequence;
      }
    } else if (event.type === "thinking.delta" || event.type === "thinking.completed") {
      const id = str(p.messageId) || `${event.runId}:assistant`;
      if (next.completedIds.includes(id)) continue;
      const existing = next.messages.find(message => message.id === id);
      const thinking = { content: typeof p.content === "string" ? p.content : (existing?.thinking?.content || "") + str(p.delta), duration: typeof p.duration === "number" ? p.duration : existing?.thinking?.duration, streaming: event.type === "thinking.delta" };
      next.messages = existing ? next.messages.map(message => message.id === id ? { ...message, thinking } : message) : [...next.messages, { id, role: "assistant", text: "", thinking, runId: event.runId, createdAt: event.createdAt }];
    } else if (event.type === "text.delta") {
      const id = str(p.messageId) || `${event.runId}:assistant`;
      if (next.completedIds.includes(id)) continue;
      const delta = str(p.delta) || str(p.text);
      const existing = next.messages.find((message) => message.id === id);
      next.messages = existing
        ? next.messages.map((message) =>
            message.id === id
              ? { ...message, text: message.text + delta, ...(message.thinking ? { thinking: { ...message.thinking, streaming: false } } : {}) }
              : message,
          )
        : [
            ...next.messages,
            {
              id,
              role: "assistant",
              text: delta,
              runId: event.runId,
              createdAt: event.createdAt,
            },
          ];
    } else if (event.type === "message.completed") {
      const raw =
        p.message && typeof p.message === "object"
          ? (p.message as Record<string, unknown>)
          : p;
      const id =
        str(raw.id) || str(raw.messageId) || `${event.runId}:assistant`;
      const existing = next.messages.find((message) => message.id === id);
      const message: CreativeAgentMessage = {
        ...existing,
        id,
        role: raw.role === "user" ? "user" : "assistant",
        text: typeof raw.text === "string" ? raw.text : (existing?.text ?? ""),
        runId: event.runId,
        createdAt: str(raw.createdAt) || event.createdAt,
        ...(raw.thinking && typeof raw.thinking === "object" && "content" in raw.thinking && typeof raw.thinking.content === "string" ? { thinking: { ...raw.thinking, content: raw.thinking.content, streaming: false } } : existing?.thinking ? { thinking: { ...existing.thinking, streaming: false } } : {}),
        ...(Array.isArray(raw.references)
          ? { references: raw.references as CreativeAgentMessage["references"] }
          : {}),
      };
      next.messages = existing
        ? next.messages.map((item) => (item.id === id ? message : item))
        : [...next.messages, message];
      next.completedIds = [...new Set([...next.completedIds, id])];
    } else if (
      event.type === "tool.started" ||
      event.type === "tool.completed"
    ) {
      const id =
        str(p.actionId) ||
        str(p.toolCallId) ||
        str(p.id) ||
        `${event.runId}:${event.sequence}`;
      const existing = next.tools.find((tool) => tool.id === id);
      const detail = p.detail && typeof p.detail === "object" ? p.detail as Record<string, unknown> : null;
      const mediaStatus = str(detail?.status);
      const failure = creativeToolFailurePresentation(str(p.name) || existing?.name || "", detail ?? {}, Boolean(p.error || p.status === "failed" || p.status === "error"));
      const outcomeLabel = failure?.outcomeLabel || (detail?.receiptState === "unknown" ? "结果待核实" : detail?.revisionRequested ? "已要求修改" : detail?.cancelled ? "已取消" : ({ pending: "已提交", queued: "已提交", processing: "已提交生成", running: "已提交生成", success: "已生成 · 待采用", failed: "生成失败", cancelled: "已取消" } as Record<string, string>)[mediaStatus]);
      const decision = detail?.decision && typeof detail.decision === "object" ? detail.decision as Record<string, unknown> : null;
      const review = typeof detail?.structuralPassed === "boolean" ? `结构检查：${detail.structuralPassed ? "通过" : "有待修正项"}\n\n${Array.isArray(detail.issues) ? detail.issues.map(item => `${str(item.segment)}：${str(item.message)}`).join("\n\n") : ""}\n\n${str(detail.coverage)}` : "";
      const readSummary = p.name === "canvas.read" && (typeof detail?.readCount === "number" || Array.isArray(detail?.nodes)) ? `已读取 ${detail.readCount ?? (detail.nodes as unknown[]).length} 个节点。` : p.name === "creative.method" ? `${str(detail?.title)}：${str(detail?.description)}` : "";
      const toolDetail = str(p.detail) || str(p.error) || str(detail?.error) || str(detail?.message) || review || str(detail?.coverage) || readSummary || existing?.detail;
      const tool: AgentTool = {
        id,
        name: str(p.name) || existing?.name,
        runId: event.runId,
        createdAt: existing?.createdAt ?? event.createdAt,
        startedSequence:existing?.startedSequence ?? (typeof p.startedSequence === "number" ? p.startedSequence : event.sequence),
        activity: (detail?.activity || p.activity || existing?.activity ? {...existing?.activity, ...(p.activity as AgentTool["activity"]), ...(detail?.activity as AgentTool["activity"])} : undefined) as AgentTool["activity"],
        title: failure?.title || str(p.title) || str(p.name) || existing?.title || "画布操作",
        detail: toolDetail === undefined ? undefined : friendlyErrorDisplayText(toolDetail),
        outcomeLabel: outcomeLabel || (event.type === "tool.completed" && ["状态未确认", "已中断"].includes(existing?.outcomeLabel || "") ? undefined : existing?.outcomeLabel),
        decision: decision ? { title: str(decision.title), question: str(decision.question), answer: str(decision.answer), skipped: decision.skipped === true, ...(Array.isArray(decision.items) ? { items: decision.items.filter((item): item is { question: string; answer: string } => Boolean(item && typeof item.question === "string" && typeof item.answer === "string")) } : {}), ...(decision.media ? { media: decision.media as NonNullable<AgentTool["decision"]>["media"] } : {}) } : existing?.decision,
        status:
          mediaStatus === "waiting" ? "running" : p.error || p.status === "failed" || p.status === "error"
            ? "failed"
            : event.type === "tool.completed"
              ? "completed"
              : "running",
        nodeIds: Array.isArray(p.nodeIds)
          ? p.nodeIds.filter((id): id is string => typeof id === "string")
          : (existing?.nodeIds ?? []),
        canUndo: Boolean(p.detail && typeof p.detail === "object" && "canUndo" in p.detail && p.detail.canUndo) || existing?.canUndo,
        ...(typeof p.progress === "number"
          ? { progress: Math.max(0, Math.min(100, p.progress)) }
          : {}),
      };
      next.tools = existing
        ? next.tools.map((item) => (item.id === id ? tool : item))
        : [...next.tools, tool];
    } else if (event.type === "decision.requested") {
      const id = str(p.decisionId) || str(p.id);
      const proposalHash = str(p.proposalHash);
      if (id && proposalHash)
        next.decision = {
          id,
          proposalHash,
          title: str(p.title) || "需要你的决定",
          question: str(p.question) || str(p.description),
          fields: Array.isArray(p.fields) ? p.fields as QuestionField[] : undefined,
          expiresAt: str(p.expiresAt) || undefined,
          ...(p.media && typeof p.media === "object" ? { media: p.media as AgentDecision["media"] } : {}),
          options: Array.isArray(p.options)
            ? p.options.flatMap((item) =>
                typeof item === "string"
                  ? [{ value: item, label: item }]
                  : item &&
                      typeof item === "object" &&
                      typeof item.value === "string" &&
                      typeof item.label === "string"
                    ? [{ value: item.value, label: item.label }]
                    : [],
              )
            : [],
        };
    } else if (event.type === "run.status") {
      if (p.status !== "waiting_decision") next.decision = null;
      if (p.model && typeof p.model === "object" && "modelId" in p.model && typeof p.model.modelId === "string") next.actualModel = p.model.modelId;
      if (typeof p.thinkingLabel === "string") next.thinkingLabel = p.thinkingLabel;
    } else if (event.type === "error") {
      next.error =
        str(p.message) || str(p.error) || "执行遇到问题，请查看任务状态。";
    }
  }
  if (!isCreativeAgentRunActive(run.status)) {
    next.finishedAtByRun = { ...next.finishedAtByRun, [run.id]: run.updatedAt };
    next.messages = next.messages.map(message => message.runId === run.id && message.thinking?.streaming ? { ...message, thinking: { ...message.thinking, streaming: false } } : message);
    next.tools = next.tools.map(tool => tool.runId === run.id && tool.status === "running" ? { ...tool, status: "failed", outcomeLabel: run.status === "completed" ? "状态未确认" : "已中断" } : tool);
  }
  if (run.status !== "waiting_decision") next.decision = null;
  return next;
}

/** Call only after a terminal run's event batches have been fully drained. */
export function finishAgentEventDrain(state: AgentViewState): AgentViewState {
  if (!state.run || isCreativeAgentRunActive(state.run.status)) return state;
  const confirmed = new Set(state.completedIds);
  return {
    ...state,
    messages: state.messages.filter(
      (message) =>
        message.role !== "assistant" ||
        message.runId !== state.run!.id ||
        confirmed.has(message.id),
    ),
  };
}
