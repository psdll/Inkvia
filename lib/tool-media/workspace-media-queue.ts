/** Uploads may overlap; releases must run alone after earlier uploads settle. */
export function createWorkspaceMediaQueue(concurrency = 3) {
  const limit = Math.max(1, Math.floor(concurrency));
  const waiting: Array<{ exclusive: boolean; run: () => void }> = [];
  const pending = new Set<Promise<void>>();
  let active = 0;
  let exclusiveActive = false;

  const drain = () => {
    while (!exclusiveActive && active < limit && waiting.length) {
      const next = waiting[0];
      if (next.exclusive && active > 0) return;
      waiting.shift();
      active += 1;
      exclusiveActive = next.exclusive;
      next.run();
    }
  };
  const enqueue = (task: () => Promise<void>, exclusive: boolean) => {
    let resolve!: () => void;
    let reject!: (error: unknown) => void;
    const result = new Promise<void>((done, fail) => { resolve = done; reject = fail; });
    pending.add(result);
    waiting.push({ exclusive, run: () => {
      Promise.resolve().then(task).then(resolve, reject).finally(() => {
        pending.delete(result);
        active -= 1;
        if (exclusive) exclusiveActive = false;
        drain();
      });
    } });
    drain();
    return result;
  };
  return {
    enqueueUpload: (task: () => Promise<void>) => enqueue(task, false),
    enqueueMutation: (task: () => Promise<void>) => enqueue(task, true),
    get idle(): Promise<void> { return Promise.allSettled([...pending]).then(() => undefined); },
  };
}
