import "server-only";
import prisma from "@/lib/prisma";

// One indexed database check per process, shared by all open material libraries.
// Using the database also observes uploads/selections from other server workers.
type Listener = (revision: string) => void;
type Hub = { listeners: Set<Listener>; timer?: ReturnType<typeof setTimeout>; revision: string; running: boolean };
const shared = globalThis as typeof globalThis & { materialLiveHub?: Hub };
const hub = shared.materialLiveHub ||= { listeners: new Set(), revision: "", running: false };

async function poll() {
  if (hub.running || !hub.listeners.size) return;
  hub.running = true;
  try {
    const { _max } = await prisma.materialAsset.aggregate({ _max: { updatedAt: true, id: true } });
    const revision = `${_max.updatedAt?.toISOString() || "empty"}:${_max.id || 0}`;
    if (revision !== hub.revision) {
      hub.revision = revision;
      for (const listener of hub.listeners) listener(revision);
    }
  } catch {
    // Existing cards remain usable; the client has a lightweight fallback sync.
  } finally {
    hub.running = false;
    if (hub.listeners.size) hub.timer = setTimeout(poll, 500);
  }
}

export function subscribeMaterialChanges(listener: Listener) {
  hub.listeners.add(listener);
  if (hub.revision) listener(hub.revision);
  if (!hub.timer) void poll();
  return () => {
    hub.listeners.delete(listener);
    if (!hub.listeners.size) {
      clearTimeout(hub.timer);
      hub.timer = undefined;
      hub.revision = "";
    }
  };
}
