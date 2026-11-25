import type { DecisionAnswer } from "./questions";
import type {
  CreativeAgentCapabilities,
  CreativeAgentControl,
  CreativeAgentEventsResponse,
  CreativeAgentMessageInput,
  CreativeAgentMessageRevision,
  CreativeAgentSessionSnapshot,
  CreativeAgentSessionSummary,
} from "./contracts";

export class CreativeAgentClientError extends Error {
  constructor(
    message: string,
    public readonly status: number | null,
  ) {
    super(message);
    this.name = "CreativeAgentClientError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      credentials: "same-origin",
      cache: "no-store",
      headers: { "Content-Type": "application/json", ...init?.headers },
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw error;
    throw new CreativeAgentClientError(
      "连接中断，执行状态尚未确认。请恢复连接后重试。",
      null,
    );
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok)
    throw new CreativeAgentClientError(
      typeof payload?.error === "string"
        ? payload.error
        : `请求失败（${response.status}）`,
      response.status,
    );
  if (!payload)
    throw new CreativeAgentClientError(
      "服务返回了无法读取的结果，执行状态尚未确认。",
      null,
    );
  return payload as T;
}

const base = "/api/creative-agent";
export const creativeAgentClient = {
  capabilities: (signal?: AbortSignal, model?: { providerId: string; modelId: string }) =>
    request<CreativeAgentCapabilities>(`${base}/capabilities${model ? `?providerId=${encodeURIComponent(model.providerId)}&modelId=${encodeURIComponent(model.modelId)}` : ""}`, { signal }),
  session: (canvasId: number, signal?: AbortSignal, sessionId?: string) =>
    request<CreativeAgentSessionSnapshot>(
      `${base}/canvases/${canvasId}/sessions${sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : ""}`,
      { signal },
    ),
  sessions: (canvasId: number, signal?: AbortSignal) =>
    request<{ sessions: CreativeAgentSessionSummary[] }>(
      `${base}/canvases/${canvasId}/sessions?list=1`, { signal },
    ),
  createSession: (canvasId: number, sessionId: string) =>
    request<{ session: CreativeAgentSessionSummary }>(
      `${base}/canvases/${canvasId}/sessions`,
      { method: "POST", body: JSON.stringify({ sessionId }) },
    ),
  renameSession: (canvasId: number, sessionId: string, title: string) =>
    request<{ session: CreativeAgentSessionSummary }>(
      `${base}/canvases/${canvasId}/sessions`,
      { method: "PATCH", body: JSON.stringify({ sessionId, title }) },
    ),
  summarizeSession: (canvasId: number, sessionId: string) =>
    request<{ session: CreativeAgentSessionSummary }>(
      `${base}/canvases/${canvasId}/sessions/title`,
      { method: "POST", body: JSON.stringify({ sessionId }) },
    ),
  send: (canvasId: number, input: CreativeAgentMessageInput) =>
    request<{ sessionId: string; runId: string }>(
      `${base}/canvases/${canvasId}/messages`,
      { method: "POST", body: JSON.stringify(input) },
    ),
  revise: (canvasId: number, input: CreativeAgentMessageRevision) =>
    request<CreativeAgentSessionSnapshot>(`${base}/canvases/${canvasId}/messages`, {
      method: "PATCH", body: JSON.stringify(input),
    }),
  events: (runId: string, after: number, signal?: AbortSignal) =>
    request<CreativeAgentEventsResponse>(
      `${base}/runs/${encodeURIComponent(runId)}/events?after=${after}`,
      { signal },
    ),
  control: (runId: string, input: CreativeAgentControl) =>
    request<{ run: CreativeAgentSessionSnapshot["run"] }>(
      `${base}/runs/${encodeURIComponent(runId)}/control`,
      { method: "POST", body: JSON.stringify(input) },
    ),
  answer: (
    decisionId: string,
    input: { requestId: string; proposalHash: string; answer: DecisionAnswer },
  ) =>
    request<unknown>(
      `${base}/decisions/${encodeURIComponent(decisionId)}/answer`,
      { method: "POST", body: JSON.stringify(input) },
    ),
};
