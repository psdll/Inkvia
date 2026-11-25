"use client";

import { fetchToolWorkspaceDraft, type ToolWorkspaceDraftDto } from "./client";

const requests = new Map<string, Promise<ToolWorkspaceDraftDto | null>>();

// Share an in-flight GET started on navigation intent. Never reuse a settled
// draft: each later visit still validates its current server version.
export function fetchImageDraftForEntry(ownerId: string) {
  const pending = requests.get(ownerId);
  if (pending) return pending;
  const request = fetchToolWorkspaceDraft("image").finally(() => {
    if (requests.get(ownerId) === request) requests.delete(ownerId);
  });
  requests.set(ownerId, request);
  return request;
}
