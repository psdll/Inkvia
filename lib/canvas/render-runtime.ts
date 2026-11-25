/**
 * Request previews by the device pixels the node actually covers (retina capped at 2x),
 * so media look sharp at normal zoom instead of only when very close. Anything that
 * needs more than the largest preview, or a selected node from 50%, loads the original.
 */
export function canvasImageTier(width: number, zoom: number, dpr: number, selected: boolean, lowDetail: boolean): number | "original" {
  if (selected && zoom >= .5) return "original";
  if (lowDetail) return 400;
  const pixels = width * zoom * Math.min(Math.max(dpr, 1), 2);
  if (pixels > 1600) return "original";
  return [100, 200, 400, 800, 1600].find(tier => tier >= pixels) ?? 1600;
}

export class CanvasWorkQueue {
  private active = 0;
  private pending: { owner: string; run: () => Promise<unknown>; priority: number }[] = [];
  constructor(private limit: number) {}
  setLimit(limit: number) { this.limit = limit; this.drain(); }
  add(owner: string, run: () => Promise<unknown>, priority = 0) {
    this.pending.push({ owner, run, priority }); this.pending.sort((a, b) => b.priority - a.priority); this.drain();
  }
  cancel(owner: string) { this.pending = this.pending.filter(item => item.owner !== owner); }
  private drain() {
    while (this.active < this.limit && this.pending.length) {
      const item = this.pending.shift()!; this.active++;
      try { Promise.resolve(item.run()).catch(() => undefined).finally(() => { this.active--; this.drain(); }); }
      catch { this.active--; }
    }
  }
}

export class CanvasLru<T> {
  private entries = new Map<string, { value: T; weight: number }>();
  private weight = 0;
  constructor(private capacity: number, private budget = Infinity, private weigh: (value: T) => number = () => 1) {}
  get(key: string) {
    const entry = this.entries.get(key);
    if (entry) { this.entries.delete(key); this.entries.set(key, entry); }
    return entry?.value;
  }
  set(key: string, value: T) {
    const previous = this.entries.get(key);
    if (previous) { this.weight -= previous.weight; this.entries.delete(key); }
    const weight = this.weigh(value);
    // A single oversized original can still be displayed, without evicting all previews.
    if (!Number.isFinite(weight) || weight < 0 || weight > this.budget) return;
    this.entries.set(key, { value, weight }); this.weight += weight;
    while (this.entries.size > this.capacity || this.weight > this.budget) {
      const [oldest, entry] = this.entries.entries().next().value!;
      this.weight -= entry.weight; this.entries.delete(oldest);
    }
  }
}

export class CanvasMountQueue {
  onPending?: () => void;
  private admitted = 0;
  private ready = new Set<string>();
  private pending = new Map<string, () => void>();
  has(id: string) { return this.ready.has(id); }
  add(id: string, mount: () => void, paused = false) { if(this.ready.has(id)) { mount(); } else if(!paused && this.admitted < 30) { this.admitted++; this.ready.add(id); mount(); } else { this.pending.set(id, mount); this.onPending?.(); } }
  cancel(id: string) { this.pending.delete(id); this.ready.delete(id); }
  prioritize(id: string) {
    const mount = this.pending.get(id);
    if (!mount) return;
    this.pending.delete(id);
    this.ready.add(id);
    mount();
  }
  get size() { return this.pending.size; }
  /** Upgrade four nodes per idle frame; keep trickling one per frame while the camera moves. */
  flush(paused: boolean) { for(const [id, mount] of [...this.pending].slice(0, paused ? 1 : 4)) { this.pending.delete(id); this.ready.add(id); mount(); } }
}

/** Bounded keepalive ownership; eviction releases the decoder, not only the DOM reference. */
export class CanvasVideoRetention {
  private retained = new Map<string, () => void>();
  constructor(private capacity: number) {}
  retain(owner: string, dispose: () => void) {
    this.retained.delete(owner); this.retained.set(owner, dispose);
    while(this.retained.size > this.capacity) {
      const [key, release] = this.retained.entries().next().value!;
      this.retained.delete(key); release();
    }
  }
  release(owner: string) { this.retained.delete(owner); }
}
