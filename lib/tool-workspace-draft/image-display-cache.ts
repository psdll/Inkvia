"use client";

import type { ToolWorkspaceDraftDto } from "@/lib/tool-workspace-draft/client";

type StorageLike = Pick<Storage, "getItem" | "setItem">;

export type ImageWorkspaceDisplayCache = {
  schemaVersion: 1;
  userId: string;
  savedAt: string;
  draft: ToolWorkspaceDraftDto | null;
  visibleModelIds: string[];
};

type ImageWorkspaceDisplayCacheUpdate = {
  userId: string;
  draft?: ToolWorkspaceDraftDto | null;
  visibleModelIds?: string[];
};

export function isImageWorkspaceDisplayReady(input: {
  authLoading: boolean;
  userId: string;
  displayCacheRestored: boolean;
  modelsSettled: boolean;
  workspaceDraftHydrated: boolean;
}) {
  if (input.authLoading) return false;
  return input.modelsSettled && (!input.userId || input.workspaceDraftHydrated);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNullableString(value: unknown) {
  return value === null || typeof value === "string";
}

function isImageWorkspaceDraft(value: unknown): value is ToolWorkspaceDraftDto {
  if (!isRecord(value) || value.tool !== "image" || !isRecord(value.payload) || !Array.isArray(value.media)) {
    return false;
  }
  if (
    typeof value.id !== "string"
    || !Number.isInteger(value.schemaVersion)
    || !Number.isInteger(value.version)
    || Number(value.version) < 0
    || typeof value.updatedAt !== "string"
  ) {
    return false;
  }
  return value.media.every((candidate) => {
    if (!isRecord(candidate)) return false;
    return (
      typeof candidate.relationId === "string"
      && typeof candidate.mediaId === "string"
      && Number.isInteger(candidate.position)
      && (candidate.slot === null || candidate.slot === "first" || candidate.slot === "last")
      && isNullableString(candidate.kind)
      && isNullableString(candidate.status)
      && isNullableString(candidate.originalName)
      && isNullableString(candidate.mimeType)
      && (candidate.sizeBytes === null || Number.isFinite(candidate.sizeBytes))
      && isNullableString(candidate.localPreviewUrl)
      && typeof candidate.createdAt === "string"
    );
  });
}

function normalizeModelIds(value: unknown) {
  if (!Array.isArray(value)) return null;
  const ids = value
    .filter((candidate): candidate is string => typeof candidate === "string")
    .map((candidate) => candidate.trim())
    .filter(Boolean);
  return [...new Set(ids)];
}

export function readImageWorkspaceDisplayCache(
  storage: StorageLike,
  key: string,
  userId: string,
): ImageWorkspaceDisplayCache | null {
  try {
    const parsed = JSON.parse(storage.getItem(key) || "null") as unknown;
    if (!isRecord(parsed) || parsed.schemaVersion !== 1 || parsed.userId !== userId) return null;
    if (typeof parsed.savedAt !== "string") return null;
    if (parsed.draft !== null && !isImageWorkspaceDraft(parsed.draft)) return null;
    const visibleModelIds = normalizeModelIds(parsed.visibleModelIds);
    if (!visibleModelIds) return null;
    return {
      schemaVersion: 1,
      userId,
      savedAt: parsed.savedAt,
      draft: parsed.draft,
      visibleModelIds,
    };
  } catch {
    return null;
  }
}

export function updateImageWorkspaceDisplayCache(
  storage: StorageLike,
  key: string,
  update: ImageWorkspaceDisplayCacheUpdate,
) {
  const userId = String(update.userId || "").trim();
  if (!userId) throw new Error("Image workspace display cache requires a user ID");
  if (update.draft !== undefined && update.draft !== null && !isImageWorkspaceDraft(update.draft)) {
    throw new Error("Image workspace display cache draft is invalid");
  }
  const previous = readImageWorkspaceDisplayCache(storage, key, userId);
  const visibleModelIds = update.visibleModelIds === undefined
    ? previous?.visibleModelIds || []
    : normalizeModelIds(update.visibleModelIds);
  if (!visibleModelIds) throw new Error("Image workspace display cache model list is invalid");
  const next: ImageWorkspaceDisplayCache = {
    schemaVersion: 1,
    userId,
    savedAt: new Date().toISOString(),
    draft: update.draft === undefined ? previous?.draft || null : update.draft,
    visibleModelIds,
  };
  storage.setItem(key, JSON.stringify(next));
  return next;
}
