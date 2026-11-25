import "server-only";

type ShutdownState = {
  closing: boolean;
  listeners: Set<() => void>;
};

// Route bundles share one signal listener pair, regardless of the number of clients.
const shared = globalThis as typeof globalThis & { serverStreamShutdown?: ShutdownState };

export function onServerStreamShutdown(close: () => void): () => void {
  if (!shared.serverStreamShutdown) {
    const state: ShutdownState = { closing: false, listeners: new Set() };
    shared.serverStreamShutdown = state;
    const shutdown = () => {
      if (state.closing) return;
      state.closing = true;
      for (const listener of [...state.listeners]) {
        try {
          listener();
        } catch (error) {
          console.error("[shutdown] Failed to close event stream", error);
        }
      }
      state.listeners.clear();
    };
    // Keep Next.js's handlers: closing our streams lets server.close() finish.
    process.once("SIGTERM", shutdown);
    process.once("SIGINT", shutdown);
  }
  const state = shared.serverStreamShutdown;
  if (state.closing) {
    close();
    return () => {};
  }
  state.listeners.add(close);
  return () => { state.listeners.delete(close); };
}
