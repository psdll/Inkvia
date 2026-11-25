"use client";

import type { ToolWorkspaceTool } from "./contracts";

const pendingSaves = new Map<string, Promise<void>>();

export function trackWorkspaceNavigationSave(tool: ToolWorkspaceTool, ownerId: string, save: Promise<void>) {
  const key = `${tool}:${ownerId}`;
  const settled = save.catch(() => undefined).finally(() => {
    if (pendingSaves.get(key) === settled) pendingSaves.delete(key);
  });
  pendingSaves.set(key, settled);
}

export function pendingWorkspaceNavigationSave(tool: ToolWorkspaceTool, ownerId: string) {
  return pendingSaves.get(`${tool}:${ownerId}`);
}
