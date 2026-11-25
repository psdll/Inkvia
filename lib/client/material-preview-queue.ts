"use client";
import { hasLoadedResilientImageCandidates, warmResilientImageCandidates } from "@/components/ui/resilient-image";

type Job = {
  key: string; candidates: string[]; priority: number;
  listeners: Set<() => void>; controller?: AbortController; restart?: boolean;
};
const jobs = new Map<string, Job>();
let running = 0;
let pumpScheduled = false;

function schedulePump() {
  if (pumpScheduled) return;
  pumpScheduled = true;
  // Collect this render's subscriptions before choosing work. DOM order puts
  // offscreen cards first when scrolling back, but visible cards must win.
  queueMicrotask(() => { pumpScheduled = false; pump(); });
}

function pump() {
  const visibleWaiting = [...jobs.values()].some(job => !job.controller && job.priority >= 100000);
  if (running >= 6 && visibleWaiting) {
    const background = [...jobs.values()].filter(job => job.controller && !job.controller.signal.aborted && job.priority < 100000)
      .sort((a, b) => a.priority - b.priority)[0];
    if (background) { background.restart = true; background.controller!.abort(); }
  }
  while (running < 6) {
    const job = [...jobs.values()].filter(job => !job.controller && job.listeners.size)
      .sort((a, b) => b.priority - a.priority)[0];
    if (!job) return;
    running++;
    job.controller = new AbortController();
    void warmResilientImageCandidates(job.candidates, { signal: job.controller.signal, priority: job.priority >= 100000 ? "visible" : "prefetch" })
      .catch(() => null).then(() => {
        if (!job.controller?.signal.aborted) for (const listener of job.listeners) listener();
      }).finally(() => {
        if (jobs.get(job.key) === job) {
          if (job.restart && job.listeners.size) { job.controller = undefined; job.restart = false; }
          else jobs.delete(job.key);
        }
        running--;
        schedulePump();
      });
  }
}

export function subscribeMaterialPreview(candidates: string[], priority: number, ready: () => void) {
  if (hasLoadedResilientImageCandidates(candidates)) {
    ready();
    return Object.assign(() => {}, { setPriority: (_value: number) => {} });
  }
  const key = candidates.join("|");
  let job = jobs.get(key);
  if (!job) {
    job = { key, candidates, priority, listeners: new Set() };
    jobs.set(key, job);
  }
  const owned = job;
  owned.priority = Math.max(priority, owned.priority);
  owned.listeners.add(ready);
  schedulePump();
  const cancel = () => {
    owned.listeners.delete(ready);
    if (owned.listeners.size) return;
    owned.controller?.abort();
    if (jobs.get(key) === owned) jobs.delete(key);
  };
  cancel.setPriority = (value: number) => { owned.priority = value; schedulePump(); };
  return cancel;
}
