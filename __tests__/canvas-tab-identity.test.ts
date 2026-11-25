import { describe, expect, it } from "vitest";
import {
  CANVAS_TAB_ID_STORAGE_KEY,
  claimCanvasTabIdentity,
  getOrCreateCanvasTabId,
  type CanvasBroadcastChannelLike,
  type CanvasTabStorage,
} from "@/lib/canvas/tab-identity";

class MemoryStorage implements CanvasTabStorage {
  constructor(private readonly values = new Map<string, string>()) {}
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

class FakeChannelNetwork {
  private readonly channels = new Set<FakeChannel>();
  create = (): CanvasBroadcastChannelLike => {
    const channel = new FakeChannel(this);
    this.channels.add(channel);
    return channel;
  };
  broadcast(source: FakeChannel, data: unknown) {
    for (const channel of this.channels) {
      if (channel !== source) queueMicrotask(() => channel.dispatch(data));
    }
  }
  close(channel: FakeChannel) { this.channels.delete(channel); }
}

class FakeChannel implements CanvasBroadcastChannelLike {
  private readonly listeners = new Set<(event: MessageEvent) => void>();
  constructor(private readonly network: FakeChannelNetwork) {}
  postMessage(data: unknown) { this.network.broadcast(this, data); }
  addEventListener(_type: "message", listener: (event: MessageEvent) => void) { this.listeners.add(listener); }
  removeEventListener(_type: "message", listener: (event: MessageEvent) => void) { this.listeners.delete(listener); }
  dispatch(data: unknown) { for (const listener of this.listeners) listener({ data } as MessageEvent); }
  close() { this.network.close(this); }
}

describe("canvas tab identity", () => {
  it("keeps a stable session id across reloads", () => {
    const storage = new MemoryStorage();
    let generated = 0;
    const randomId = () => `tab-${++generated}`;

    expect(getOrCreateCanvasTabId(storage, randomId)).toBe("tab-1");
    expect(getOrCreateCanvasTabId(storage, randomId)).toBe("tab-1");
    expect(storage.getItem(CANVAS_TAB_ID_STORAGE_KEY)).toBe("tab-1");
  });

  it("regenerates an identity cloned by a duplicated browser tab", async () => {
    const firstStorage = new MemoryStorage(new Map([[CANVAS_TAB_ID_STORAGE_KEY, "shared-tab"]]));
    const secondStorage = new MemoryStorage(new Map([[CANVAS_TAB_ID_STORAGE_KEY, "shared-tab"]]));
    const network = new FakeChannelNetwork();
    const ids = ["nonce-a", "nonce-b", "fresh-tab", "nonce-c"];
    const randomId = () => ids.shift() || crypto.randomUUID();

    const first = await claimCanvasTabIdentity({ storage: firstStorage, channelFactory: network.create, randomId, probeMs: 1 });
    const second = await claimCanvasTabIdentity({ storage: secondStorage, channelFactory: network.create, randomId, probeMs: 1 });

    expect(first.tabId).toBe("shared-tab");
    expect(second.tabId).toBe("fresh-tab");
    expect(secondStorage.getItem(CANVAS_TAB_ID_STORAGE_KEY)).toBe("fresh-tab");
    expect(first.coordinated).toBe(true);
    expect(second.coordinated).toBe(true);
    first.release();
    second.release();
  });

  it("marks multi-tab recovery unavailable when BroadcastChannel is missing", async () => {
    const storage = new MemoryStorage();
    const identity = await claimCanvasTabIdentity({ storage, randomId: () => "tab-only" });

    expect(identity).toEqual(expect.objectContaining({ tabId: "tab-only", coordinated: false }));
    identity.release();
  });
});
