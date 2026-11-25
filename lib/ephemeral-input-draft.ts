"use client";

export type EphemeralInputDraftRegistry = ReturnType<typeof createEphemeralInputDraftRegistry>;

// Unsubmitted creation inputs belong to the current JavaScript document only.
// Route changes reuse this module instance; reloads, new tabs, and other browsers do not.
// Do not mirror entries from this registry into Web Storage or account-level draft APIs.

function registryKey(surface: string, ownerId: string) {
  const normalizedSurface = String(surface || "").trim();
  const normalizedOwnerId = String(ownerId || "").trim();
  return normalizedSurface && normalizedOwnerId
    ? `${normalizedOwnerId}\u0000${normalizedSurface}`
    : "";
}

export function createEphemeralInputDraftRegistry() {
  const drafts = new Map<string, unknown>();

  return {
    read<T>(surface: string, ownerId: string): T | null {
      const key = registryKey(surface, ownerId);
      return key && drafts.has(key) ? drafts.get(key) as T : null;
    },

    write<T>(surface: string, ownerId: string, draft: T) {
      const key = registryKey(surface, ownerId);
      if (key) drafts.set(key, draft);
    },

    clear(surface: string, ownerId: string) {
      const key = registryKey(surface, ownerId);
      if (key) drafts.delete(key);
    },

    clearOwner(ownerId: string) {
      const prefix = `${String(ownerId || "").trim()}\u0000`;
      if (prefix === "\u0000") return;
      for (const key of drafts.keys()) {
        if (key.startsWith(prefix)) drafts.delete(key);
      }
    },
  };
}

export const ephemeralInputDraftRegistry = createEphemeralInputDraftRegistry();

export type EphemeralToolTemplate = "image" | "video";

function toolTemplateSurface(tool: EphemeralToolTemplate) {
  return `toolbox-template:${tool}`;
}

export function writeEphemeralToolTemplate<T>(tool: EphemeralToolTemplate, ownerId: string, payload: T) {
  ephemeralInputDraftRegistry.write(toolTemplateSurface(tool), ownerId, payload);
}

export function takeEphemeralToolTemplate<T>(tool: EphemeralToolTemplate, ownerId: string): T | null {
  const surface = toolTemplateSurface(tool);
  const payload = ephemeralInputDraftRegistry.read<T>(surface, ownerId);
  if (payload !== null) ephemeralInputDraftRegistry.clear(surface, ownerId);
  return payload;
}
