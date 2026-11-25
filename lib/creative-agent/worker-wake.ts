/** Same-process hint only; the existing database claim locks and polling remain authoritative. */
type WakeState = { handler?: () => Promise<unknown>; pending: boolean; running: boolean };
const key = Symbol.for("creative-agent.worker-wake.v1");
const globals = globalThis as typeof globalThis & { [key]?: WakeState };
const state = globals[key] ??= { pending: false, running: false };
export function registerCreativeAgentWake(handler: () => Promise<unknown>) {
  state.handler = handler;
  return () => { if (state.handler === handler) state.handler = undefined; };
}
export function wakeCreativeAgentWorker() {
  if (!state.handler) return;
  state.pending = true;
  if (state.running) return;
  state.running = true;
  queueMicrotask(async () => {
    try {
      while (state.pending && state.handler) {
        state.pending = false;
        await state.handler().catch(() => undefined);
      }
    } finally { state.running = false; }
  });
}
