const IDLE_MS = 5 * 60_000;
const RETRY_MS = 5_000;
const CRASH_WINDOW_MS = 60_000;

function createWorkerScheduler(workers, { launch, report, now = Date.now, idleMs = IDLE_MS }) {
  const states = new Map(workers.map(worker => [worker.name, {
    running: null, lastWork: 0, failures: [], retryAt: 0, blocked: false,
  }]));
  let stopping = false;

  function reconcile(pending) {
    if (stopping) return;
    const time = now();
    for (const worker of workers) {
      const state = states.get(worker.name);
      const wanted = worker.resident || pending[worker.name];
      if (wanted) state.lastWork = time;
      if (state.running) {
        if (!wanted && !state.running.draining && time - state.lastWork >= idleMs) {
          state.running.draining = state.running.drain();
        }
        continue;
      }
      if (!wanted || state.blocked || time < state.retryAt) continue;
      const running = { ...launch(worker), draining: false };
      state.running = running;
      void running.done.then(code => {
        state.running = null;
        if (stopping || (running.draining && code === 0)) return;
        const end = now();
        state.failures = [...state.failures.filter(ts => end - ts < CRASH_WINDOW_MS), end];
        state.retryAt = end + RETRY_MS;
        if (state.failures.length >= 5) {
          state.blocked = true;
          report(worker.name, "一分钟内崩溃五次，停止重启");
        }
      });
    }
  }

  return { reconcile, stop: () => { stopping = true; } };
}

module.exports = { createWorkerScheduler };
