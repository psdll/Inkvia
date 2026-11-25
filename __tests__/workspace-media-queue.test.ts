import { describe, expect, it, vi } from "vitest";
import { createWorkspaceMediaQueue } from "@/lib/tool-media/workspace-media-queue";
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; };
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

describe("workspace media upload concurrency", () => {
  it("starts three uploads without waiting for the first and refills a free slot", async () => {
    const queue = createWorkspaceMediaQueue();
    const gates = Array.from({ length: 6 }, deferred);
    const starts: number[] = [];
    const jobs = gates.map((gate, i) => queue.enqueueUpload(async () => { starts.push(i); await gate.promise; }));
    await flush();
    expect(starts).toEqual([0, 1, 2]);
    gates[1].resolve(); await flush();
    expect(starts).toEqual([0, 1, 2, 3]);
    gates.forEach(gate => gate.resolve());
    await Promise.all(jobs);
    expect(starts).toEqual([0, 1, 2, 3, 4, 5]);
  });
  it("keeps release operations exclusive and makes draft saves wait for all queued work", async () => {
    const queue = createWorkspaceMediaQueue();
    const first = deferred(), second = deferred(), release = deferred(), last = deferred();
    const released = vi.fn(async () => release.promise), after = vi.fn(async () => last.promise), saved = vi.fn();
    const jobs = [queue.enqueueUpload(() => first.promise), queue.enqueueUpload(() => second.promise),
      queue.enqueueMutation(released), queue.enqueueUpload(after)];
    const save = queue.idle.then(saved);
    first.resolve(); await flush();
    expect(released).not.toHaveBeenCalled();
    second.resolve(); await flush();
    expect(released).toHaveBeenCalledOnce();
    expect(after).not.toHaveBeenCalled();
    release.resolve(); await flush();
    expect(after).toHaveBeenCalledOnce();
    expect(saved).not.toHaveBeenCalled();
    last.resolve(); await Promise.all(jobs); await save;
    expect(saved).toHaveBeenCalledOnce();
  });
  it("a failed upload does not block queued uploads, releases or draft saves", async () => {
    const queue = createWorkspaceMediaQueue(1);
    const failure = queue.enqueueUpload(async () => { throw new Error("network"); });
    const rejected = expect(failure).rejects.toThrow("network");
    const upload = vi.fn(async () => {}), release = vi.fn(async () => {});
    const next = queue.enqueueUpload(upload), last = queue.enqueueMutation(release);
    await rejected; await queue.idle; await next; await last;
    expect(upload).toHaveBeenCalledOnce(); expect(release).toHaveBeenCalledOnce();
  });
});
