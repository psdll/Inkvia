export const CANVAS_TAB_ID_STORAGE_KEY = "canvas:workspace-tab-id:v1";
const CANVAS_TAB_CHANNEL_NAME = "canvas:workspace-tab-identity:v1";

export interface CanvasTabStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface CanvasBroadcastChannelLike {
  postMessage(data: unknown): void;
  addEventListener(type: "message", listener: (event: MessageEvent) => void): void;
  removeEventListener(type: "message", listener: (event: MessageEvent) => void): void;
  close(): void;
}

type ProbeMessage = { type: "probe"; tabId: string; nonce: string; settled: boolean };
type ConflictMessage = { type: "conflict"; tabId: string; targetNonce: string };

function defaultRandomId(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function defaultStorage(): CanvasTabStorage | null {
  return typeof window !== "undefined" ? window.sessionStorage : null;
}

function defaultChannelFactory(): (() => CanvasBroadcastChannelLike) | null {
  if (typeof window === "undefined" || typeof window.BroadcastChannel !== "function") return null;
  return () => new window.BroadcastChannel(CANVAS_TAB_CHANNEL_NAME);
}

export function getOrCreateCanvasTabId(
  storage: CanvasTabStorage,
  randomId: () => string = defaultRandomId,
): string {
  const existing = String(storage.getItem(CANVAS_TAB_ID_STORAGE_KEY) || "").trim();
  if (existing) return existing;
  const created = randomId();
  storage.setItem(CANVAS_TAB_ID_STORAGE_KEY, created);
  return created;
}

export async function claimCanvasTabIdentity(options: {
  storage?: CanvasTabStorage;
  channelFactory?: (() => CanvasBroadcastChannelLike) | null;
  randomId?: () => string;
  probeMs?: number;
} = {}): Promise<{ tabId: string; coordinated: boolean; release: () => void }> {
  const storage = options.storage ?? defaultStorage();
  const randomId = options.randomId ?? defaultRandomId;
  if (!storage) {
    return { tabId: randomId(), coordinated: false, release: () => undefined };
  }
  let tabId = getOrCreateCanvasTabId(storage, randomId);
  const factory = options.channelFactory === undefined ? defaultChannelFactory() : options.channelFactory;
  if (!factory) return { tabId, coordinated: false, release: () => undefined };

  let channel: CanvasBroadcastChannelLike;
  try {
    channel = factory();
  } catch {
    return { tabId, coordinated: false, release: () => undefined };
  }

  let currentNonce = "";
  let conflict = false;
  let settled = false;
  let released = false;

  const onMessage = (event: MessageEvent) => {
    const message = event.data as ProbeMessage | ConflictMessage | null;
    if (!message || typeof message !== "object" || released) return;
    if (message.type === "conflict" && message.tabId === tabId && message.targetNonce === currentNonce) {
      conflict = true;
      return;
    }
    if (message.type !== "probe" || message.tabId !== tabId || message.nonce === currentNonce) return;
    if (settled || (!message.settled && currentNonce && currentNonce.localeCompare(message.nonce) < 0)) {
      channel.postMessage({ type: "conflict", tabId, targetNonce: message.nonce } satisfies ConflictMessage);
    }
  };
  channel.addEventListener("message", onMessage);

  const probeMs = Math.max(0, options.probeMs ?? 40);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    currentNonce = randomId();
    conflict = false;
    channel.postMessage({ type: "probe", tabId, nonce: currentNonce, settled: false } satisfies ProbeMessage);
    await new Promise<void>((resolve) => setTimeout(resolve, probeMs));
    if (!conflict) {
      settled = true;
      channel.postMessage({ type: "probe", tabId, nonce: currentNonce, settled: true } satisfies ProbeMessage);
      return {
        tabId,
        coordinated: true,
        release: () => {
          if (released) return;
          released = true;
          channel.removeEventListener("message", onMessage);
          channel.close();
        },
      };
    }
    tabId = randomId();
    storage.setItem(CANVAS_TAB_ID_STORAGE_KEY, tabId);
  }

  channel.removeEventListener("message", onMessage);
  channel.close();
  return { tabId, coordinated: false, release: () => undefined };
}
