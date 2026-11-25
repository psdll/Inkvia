export const CANVAS_EDITOR_SESSION_HEARTBEAT_MS = 3_000;
export const CANVAS_EDITOR_SESSION_LEASE_MS = 120_000;
const CANVAS_EDITOR_SESSION_CHANNEL_PREFIX = "canvas:editor-session:v1:";

export type CanvasEditorSessionRecord = {
  sessionId: string;
  expiresAt: string;
};

export interface CanvasEditorSessionChannel {
  postMessage(data: unknown): void;
  addEventListener(type: "message", listener: (event: MessageEvent) => void): void;
  removeEventListener(type: "message", listener: (event: MessageEvent) => void): void;
  close(): void;
}

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

type SessionClaimMessage = {
  type: "claimed";
  canvasId: number;
  sessionId: string;
};

function randomSessionId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function defaultChannelFactory(name: string): CanvasEditorSessionChannel | null {
  if (typeof window === "undefined" || typeof window.BroadcastChannel !== "function") return null;
  return new window.BroadcastChannel(name);
}

export function canvasEditorSessionKey(authUserId: number, canvasId: number) {
  return `canvas.editor-session:${authUserId}:${canvasId}`;
}

export function parseCanvasEditorSessionRecord(value: string | null | undefined): CanvasEditorSessionRecord | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<CanvasEditorSessionRecord>;
    const sessionId = typeof parsed.sessionId === "string" ? parsed.sessionId.trim() : "";
    const expiresAt = typeof parsed.expiresAt === "string" ? parsed.expiresAt.trim() : "";
    if (!sessionId || !expiresAt || Number.isNaN(Date.parse(expiresAt))) return null;
    return { sessionId, expiresAt };
  } catch {
    return null;
  }
}

async function responseCode(response: Response) {
  const payload = await response.json().catch(() => null) as { code?: unknown; error?: unknown } | null;
  return {
    code: typeof payload?.code === "string" ? payload.code : "CANVAS_SESSION_FAILED",
    error: typeof payload?.error === "string" ? payload.error : "Canvas editor session request failed",
  };
}

export async function claimCanvasEditorSession(options: {
  authUserId: number;
  canvasId: number;
  sessionId?: string;
  fetcher?: FetchLike;
  channelFactory?: ((name: string) => CanvasEditorSessionChannel) | null;
  heartbeatMs?: number;
  onExpired: () => void;
}): Promise<{ sessionId: string; release: () => void }> {
  const fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis);
  const sessionId = options.sessionId ?? randomSessionId();
  const endpoint = `/api/canvas/${options.canvasId}/session`;
  const body = JSON.stringify({ sessionId });
  const claimed = await fetcher(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
  if (!claimed.ok) {
    const failure = await responseCode(claimed);
    throw new Error(`${failure.code}: ${failure.error}`);
  }

  let released = false;
  let expired = false;
  let heartbeatRunning = false;
  const expire = () => {
    if (expired || released) return;
    expired = true;
    options.onExpired();
  };

  const channelName = `${CANVAS_EDITOR_SESSION_CHANNEL_PREFIX}${options.authUserId}:${options.canvasId}`;
  let channel: CanvasEditorSessionChannel | null = null;
  try {
    channel = options.channelFactory === null
      ? null
      : options.channelFactory
        ? options.channelFactory(channelName)
        : defaultChannelFactory(channelName);
  } catch {
    channel = null;
  }
  const onMessage = (event: MessageEvent) => {
    const message = event.data as Partial<SessionClaimMessage> | null;
    if (!message || message.type !== "claimed" || message.canvasId !== options.canvasId) return;
    if (typeof message.sessionId === "string" && message.sessionId !== sessionId) expire();
  };
  channel?.addEventListener("message", onMessage);
  channel?.postMessage({ type: "claimed", canvasId: options.canvasId, sessionId } satisfies SessionClaimMessage);

  const heartbeat = async () => {
    if (released || expired || heartbeatRunning) return;
    heartbeatRunning = true;
    try {
      const response = await fetcher(endpoint, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body,
      });
      if (!response.ok) {
        const failure = await responseCode(response);
        if (response.status === 409 || failure.code === "CANVAS_SESSION_EXPIRED") expire();
      }
    } catch {
      // A transient network failure must not invalidate an otherwise active editor.
    } finally {
      heartbeatRunning = false;
    }
  };

  const heartbeatMs = Math.max(250, options.heartbeatMs ?? CANVAS_EDITOR_SESSION_HEARTBEAT_MS);
  const timer = globalThis.setInterval(() => { void heartbeat(); }, heartbeatMs);
  const onVisibilityChange = () => {
    if (typeof document !== "undefined" && document.visibilityState === "visible") void heartbeat();
  };
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisibilityChange);

  return {
    sessionId,
    release: () => {
      if (released) return;
      released = true;
      globalThis.clearInterval(timer);
      if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisibilityChange);
      channel?.removeEventListener("message", onMessage);
      channel?.close();
      // The tab-scoped session ID survives effect restarts and page reloads. Let the
      // short server lease expire instead of letting an older cleanup delete its successor.
    },
  };
}
