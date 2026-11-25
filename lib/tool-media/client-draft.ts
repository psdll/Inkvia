"use client";

import { buildGenerationInputSubmission } from "@/lib/generation/input-manifest";
import {
  getSeedanceMediaPolicy,
  getSeedanceUploadContract,
  type SeedanceMediaProbe,
} from "@/lib/seedance-media-policy";
import { getMiniMaxH3UploadContract } from "@/lib/minimax-h3-media-policy";
import { getWanUploadContract } from "@/lib/wan-media-policy";
import { validateUploadDeclaration } from "@/lib/upload-validation";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type ToolMediaDraftTool = "image" | "video";
export type GenerationSubmissionPhase = "idle" | "validating" | "enhancing" | "submitting";
export type ToolMediaUploadState = "queued" | "uploading" | "verifying" | "ready" | "failed";

export type ToolMediaClientItem = {
  file?: File | null;
  url?: string | null;
  mediaId?: string;
  paintOriginalUrl?: string | null;
  uploadError?: string;
  uploadRequestId?: string;
  uploadState?: ToolMediaUploadState;
  kind?: "image" | "video" | "audio";
  byteSize?: number;
  probe?: SeedanceMediaProbe;
  replacement?: {
    previousItem: ToolMediaClientItem;
  };
  [key: string]: unknown;
};

export type ToolMediaDraft = {
  draftSessionId: string;
  items: Array<{
    mediaId: string;
    slot?: "first" | "last";
    position?: number;
  }>;
};

export type ToolMediaDraftServerItem = {
  mediaId?: unknown;
  status?: unknown;
  localPreviewUrl?: unknown;
  kind?: unknown;
  sizeBytes?: unknown;
  probe?: unknown;
};

export type ToolMediaTemplateInput = ToolMediaDraftServerItem & {
  position?: unknown;
};

export type ToolMediaUploadCommit = {
  readyMediaId: string;
  previousMediaId?: string;
} & (
  | { pendingFile: File }
  | { pendingSourceUrl: string; pendingRequestId: string }
);

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const rememberedToolMediaItems = new Map<string, ToolMediaClientItem[]>();

function rememberedToolMediaKey(tool: ToolMediaDraftTool, userId: string) {
  const normalizedUserId = String(userId || "").trim();
  return normalizedUserId ? `${tool}:${normalizedUserId}` : "";
}

function cloneRememberedToolMediaItems(items: ToolMediaClientItem[]) {
  return items.map((item) => ({ ...item }));
}

export function rememberToolMediaItems(
  tool: ToolMediaDraftTool,
  userId: string,
  items: ToolMediaClientItem[],
) {
  const key = rememberedToolMediaKey(tool, userId);
  if (!key) return;
  const stableItems = items.flatMap((item) => {
    const url = String(item.url || "").trim();
    if (!url || item.file || item.replacement || item.uploadError) return [];
    return [{ ...item, file: null, url }];
  });
  rememberedToolMediaItems.set(key, cloneRememberedToolMediaItems(stableItems));
}

export function readRememberedToolMediaItems(
  tool: ToolMediaDraftTool,
  userId: string,
) {
  const key = rememberedToolMediaKey(tool, userId);
  const items = key ? rememberedToolMediaItems.get(key) : undefined;
  return items ? cloneRememberedToolMediaItems(items) : null;
}

export function forgetRememberedToolMediaItems(
  tool: ToolMediaDraftTool,
  userId: string,
) {
  const key = rememberedToolMediaKey(tool, userId);
  if (key) rememberedToolMediaItems.delete(key);
}

function normalizeUuid(value: unknown) {
  const id = String(value || "")
    .trim()
    .toLowerCase();
  return UUID_PATTERN.test(id) ? id : "";
}

export function createToolClientUuid() {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const random = Math.floor(Math.random() * 16);
    const value = char === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

export function buildToolMediaDraftKey(
  tool: ToolMediaDraftTool,
  userId: string,
) {
  return `tool_media_draft_v1:${tool}:${String(userId || "").trim()}`;
}

export function buildToolMediaDraftRequestUrl(draft: ToolMediaDraft) {
  const params = new URLSearchParams();
  params.set("draftSessionId", normalizeUuid(draft.draftSessionId));
  const mediaIds = Array.from(
    new Set(draft.items.map((item) => normalizeUuid(item.mediaId)).filter(Boolean)),
  );
  if (mediaIds.length) params.set("mediaIds", mediaIds.join(","));
  return `/api/tool-media/drafts?${params.toString()}`;
}

export function serializeToolMediaDraft(input: {
  draftSessionId: string;
  items: ToolMediaClientItem[];
}) {
  const draft: ToolMediaDraft = {
    draftSessionId: normalizeUuid(input.draftSessionId),
    items: getToolMediaDraftItems(input.items),
  };
  return JSON.stringify(draft);
}

export function getToolMediaDraftItems(items: ToolMediaClientItem[]) {
  return items.flatMap((item, position) => {
    const savedItem = normalizeUuid(item.mediaId)
      ? item
      : item.replacement?.previousItem;
    const mediaId = normalizeUuid(savedItem?.mediaId);
    if (!mediaId) return [];
    const slot: "first" | "last" | undefined =
      savedItem?.slot === "first" || savedItem?.slot === "last"
        ? savedItem.slot
        : undefined;
    return [{ mediaId, ...(slot ? { slot } : {}), position }];
  });
}

export async function uploadEphemeralToolMedia(input: {
  draftSessionId: string;
  file: File;
  model?: string;
  fetcher?: typeof fetch;
  onStateChange?: (state: "uploading" | "verifying") => void;
}) {
  const draftSessionId = normalizeUuid(input.draftSessionId);
  if (!draftSessionId) throw new Error("素材会话无效");
  const modelId = String(input.model || "").trim();
  const policy = getSeedanceMediaPolicy(modelId);
  const contract = getSeedanceUploadContract(modelId) || getMiniMaxH3UploadContract(modelId) || getWanUploadContract(modelId);
  if (contract) {
    const declaration = validateUploadDeclaration(
      { size: input.file.size, mime: input.file.type },
      contract.allowedKinds,
      contract.maxBytes,
      contract.allowedMimeTypes,
    );
    if (!declaration.ok || !declaration.kind) {
      throw new Error(declaration.error || "素材文件不符合当前模型要求");
    }
    if (policy) {
      const extension = input.file.name.split(".").pop()?.trim().toLowerCase() || "";
      const filePolicy = policy[declaration.kind];
      if (!filePolicy.extensions.includes(extension)) {
        throw new Error(`${input.file.name} 的文件扩展名不符合当前模型要求`);
      }
      if (declaration.kind === "image" && input.file.size >= policy.image.maxBytes) {
        throw new Error(`${input.file.name} 必须小于 30MB`);
      }
    }
  }
  const form = new FormData();
  form.set("draftSessionId", draftSessionId);
  form.set("file", input.file);
  if (String(input.model || "").trim()) form.set("model", String(input.model).trim());
  input.onStateChange?.("uploading");
  const response = await (input.fetcher || fetch)("/api/tool-media/upload", {
    method: "POST",
    body: form,
  });
  input.onStateChange?.("verifying");
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.success === false) {
    throw new Error(String(payload?.error || "素材上传失败"));
  }
  return payload as {
    mediaId: string;
    localPreviewUrl: string;
    modelUrl: string;
    status: string;
    kind: "image" | "video" | "audio";
    probe?: SeedanceMediaProbe;
  };
}

export async function uploadEphemeralToolMediaFromSource(input: {
  draftSessionId: string;
  sourceUrl: string;
  model?: string;
  fetcher?: typeof fetch;
  onStateChange?: (state: "uploading" | "verifying") => void;
}) {
  const draftSessionId = normalizeUuid(input.draftSessionId);
  const sourceUrl = String(input.sourceUrl || "").trim();
  if (!draftSessionId) throw new Error("素材会话无效");
  if (!sourceUrl) throw new Error("素材来源地址无效");

  const form = new FormData();
  form.set("draftSessionId", draftSessionId);
  form.set("sourceUrl", sourceUrl);
  if (String(input.model || "").trim()) form.set("model", String(input.model).trim());
  input.onStateChange?.("uploading");
  const response = await (input.fetcher || fetch)("/api/tool-media/upload", {
    method: "POST",
    body: form,
  });
  input.onStateChange?.("verifying");
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.success === false) {
    throw new Error(String(payload?.error || "素材处理失败"));
  }
  return payload as {
    mediaId: string;
    localPreviewUrl: string;
    modelUrl: string;
    status: string;
    kind: "image" | "video" | "audio";
    sizeBytes: number;
    probe?: SeedanceMediaProbe;
  };
}

export async function releaseEphemeralToolMedia(input: {
  draftSessionId: string;
  mediaIds: string[];
  fetcher?: typeof fetch;
}) {
  const draftSessionId = normalizeUuid(input.draftSessionId);
  const mediaIds = Array.from(new Set(input.mediaIds.map(normalizeUuid).filter(Boolean)));
  if (!draftSessionId || !mediaIds.length) return;
  await (input.fetcher || fetch)("/api/tool-media/release", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ draftSessionId, mediaIds }),
    keepalive: true,
  }).catch(() => undefined);
}

export function parseToolMediaDraft(
  raw: string | null | undefined,
): ToolMediaDraft | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ToolMediaDraft> | null;
    const draftSessionId = normalizeUuid(parsed?.draftSessionId);
    if (!draftSessionId || !Array.isArray(parsed?.items)) return null;
    const items: ToolMediaDraft["items"] = [];
    for (const candidate of parsed.items) {
      const mediaId = normalizeUuid(candidate?.mediaId);
      if (!mediaId) return null;
      const slot =
        candidate?.slot === "first" || candidate?.slot === "last"
          ? candidate.slot
          : undefined;
      const position =
        Number.isInteger(candidate?.position) && Number(candidate.position) >= 0
          ? Number(candidate.position)
          : undefined;
      items.push({
        mediaId,
        ...(slot ? { slot } : {}),
        ...(position !== undefined ? { position } : {}),
      });
    }
    return { draftSessionId, items };
  } catch {
    return null;
  }
}

export function getOrCreateToolMediaDraftSession(
  storage: StorageLike,
  tool: ToolMediaDraftTool,
  userId: string,
  createId: () => string = createToolClientUuid,
) {
  const key = buildToolMediaDraftKey(tool, userId);
  const existing = parseToolMediaDraft(storage.getItem(key));
  if (existing) return existing;
  const draftSessionId = normalizeUuid(createId());
  if (!draftSessionId) throw new Error("无法创建素材草稿会话");
  const created: ToolMediaDraft = { draftSessionId, items: [] };
  storage.setItem(key, serializeToolMediaDraft(created));
  return created;
}

export function reconcileToolMediaDraftItems(
  draft: ToolMediaDraft,
  serverItems: ToolMediaDraftServerItem[],
  legacyItems?: ToolMediaClientItem[],
): ToolMediaClientItem[] {
  const readyById = new Map(
    serverItems.flatMap((item) => {
      const mediaId = normalizeUuid(item.mediaId);
      const url = String(item.localPreviewUrl || "").trim();
      if (!mediaId || item.status !== "ready" || !url) return [];
      return [[mediaId, { url, item }] as const];
    }),
  );

  const restoredByDraftIndex: Array<ToolMediaClientItem | null> = draft.items.map((saved) => {
    const ready = readyById.get(saved.mediaId);
    if (!ready) return null;
    return {
      mediaId: saved.mediaId,
      file: null,
      url: ready.url,
      ...(["image", "video", "audio"].includes(String(ready.item.kind))
        ? { kind: ready.item.kind as "image" | "video" | "audio" }
        : {}),
      ...(Number.isSafeInteger(Number(ready.item.sizeBytes))
        ? { byteSize: Number(ready.item.sizeBytes) }
        : {}),
      ...(ready.item.probe && typeof ready.item.probe === "object"
        ? { probe: ready.item.probe as SeedanceMediaProbe }
        : {}),
      ...(saved.slot ? { slot: saved.slot } : {}),
    };
  });
  const restoredItems = restoredByDraftIndex.filter(
    (item): item is ToolMediaClientItem => item !== null,
  );
  if (!legacyItems) return restoredItems;

  const totalCount = legacyItems.length + draft.items.length;
  const draftIndexByPosition = new Map<number, number>();
  draft.items.forEach((saved, draftIndex) => {
    const position = saved.position;
    if (
      !Number.isInteger(position) ||
      position === undefined ||
      position < 0 ||
      position >= totalCount ||
      draftIndexByPosition.has(position)
    ) {
      return;
    }
    draftIndexByPosition.set(position, draftIndex);
  });

  const orderedItems: ToolMediaClientItem[] = [];
  const positionedDraftIndices = new Set<number>();
  let legacyIndex = 0;
  for (let position = 0; position < totalCount; position += 1) {
    const draftIndex = draftIndexByPosition.get(position);
    if (draftIndex !== undefined) {
      positionedDraftIndices.add(draftIndex);
      const restored = restoredByDraftIndex[draftIndex];
      if (restored) orderedItems.push(restored);
      continue;
    }
    const legacyItem = legacyItems[legacyIndex];
    if (legacyItem) {
      orderedItems.push(legacyItem);
      legacyIndex += 1;
    }
  }
  orderedItems.push(...legacyItems.slice(legacyIndex));
  restoredByDraftIndex.forEach((restored, draftIndex) => {
    if (restored && !positionedDraftIndices.has(draftIndex)) {
      orderedItems.push(restored);
    }
  });
  return orderedItems;
}

export function restoreToolMediaTemplateItems(input: {
  inputMedia?: unknown;
  imagePaths?: unknown;
}): ToolMediaClientItem[] {
  const mediaItems = Array.isArray(input.inputMedia)
    ? (input.inputMedia as ToolMediaTemplateInput[])
        .flatMap((item, index) => {
          const mediaId = normalizeUuid(item?.mediaId);
          const url = String(item?.localPreviewUrl || "").trim();
          if (!mediaId || item?.status !== "ready" || !url) return [];
          const rawPosition = Number(item?.position);
          const position = Number.isInteger(rawPosition) && rawPosition >= 0
            ? rawPosition
            : index;
          return [{ mediaId, file: null, url, position, index }];
        })
        .sort((left, right) => left.position - right.position || left.index - right.index)
    : [];

  const seenMediaIds = new Set<string>();
  const seenUrls = new Set<string>();
  const restored: ToolMediaClientItem[] = [];
  for (const item of mediaItems) {
    if (seenMediaIds.has(item.mediaId)) continue;
    seenMediaIds.add(item.mediaId);
    seenUrls.add(item.url);
    restored.push({ mediaId: item.mediaId, file: null, url: item.url });
  }

  if (!Array.isArray(input.imagePaths)) return restored;
  for (const candidate of input.imagePaths) {
    const url = String(candidate || "").trim();
    if (!url || isToolMediaPreviewUrl(url) || seenUrls.has(url)) continue;
    seenUrls.add(url);
    restored.push({ file: null, url });
  }
  return restored;
}

export function hasPendingToolMediaUploads(
  items: ToolMediaClientItem[],
  isLegacyPending?: (item: ToolMediaClientItem) => boolean,
) {
  return items.some(
    (item) =>
      !String(item.uploadError || "").trim() &&
      (item.uploadState === "queued" ||
        item.uploadState === "uploading" ||
        item.uploadState === "verifying" ||
        (item.uploadState !== "ready" && item.uploadState !== "failed" && Boolean(item.file)) ||
        Boolean(item.mediaId && !String(item.url || "").trim()) ||
        Boolean(isLegacyPending?.(item))),
  );
}

export function hasFailedToolMediaUploads(items: ToolMediaClientItem[]) {
  return items.some(
    (item) => item.uploadState === "failed" || Boolean(String(item.uploadError || "").trim()),
  );
}

export function getToolMediaGenerateButtonState(input: {
  items: ToolMediaClientItem[];
  phase: GenerationSubmissionPhase;
  hasPrompt: boolean;
  idleLabel?: string;
  isLegacyPending?: (item: ToolMediaClientItem) => boolean;
}) {
  const pending = hasPendingToolMediaUploads(
    input.items,
    input.isLegacyPending,
  );
  const failed = hasFailedToolMediaUploads(input.items);
  const submitting = input.phase !== "idle";
  return {
    disabled: submitting || !input.hasPrompt || pending || failed,
    label:
      input.phase === "validating"
        ? "正在检查素材…"
        : input.phase === "enhancing"
          ? "正在运行技能…"
        : input.phase === "submitting"
          ? "正在提交模型…"
          : failed
            ? "请处理上传失败素材"
            : pending
              ? "素材上传中…"
              : input.idleLabel || "生成",
  };
}

export function partitionToolMediaInputs(items: ToolMediaClientItem[]) {
  const { manifest, toolMediaIds, legacyPaths } =
    buildGenerationInputSubmission(items);
  return { manifest, toolMediaIds, legacyPaths };
}

export function getToolMediaWorkspaceLegacyPaths(
  items: ToolMediaClientItem[],
) {
  return items.flatMap((item) => {
    const savedItem = item.replacement?.previousItem || item;
    if (normalizeUuid(savedItem.mediaId) || savedItem.file) return [];
    const url = String(savedItem.url || "").trim();
    if (!url || url.startsWith("blob:") || isToolMediaPreviewUrl(url)) return [];
    return [url];
  });
}

export function isToolMediaPreviewUrl(value: unknown) {
  const url = String(value || "")
    .trim()
    .replaceAll("\\", "/");
  if (
    url.startsWith("/uploads/tool_inputs/") ||
    url.startsWith("uploads/tool_inputs/")
  )
    return true;
  try {
    return new URL(url).pathname.startsWith("/uploads/tool_inputs/");
  } catch {
    return false;
  }
}

export function isToolMediaUploadFile(file: File, options?: { allowAudio?: boolean }) {
  const mime = String(file.type || "").toLowerCase();
  if (mime.startsWith("image/") || mime.startsWith("video/")) return true;
  if (options?.allowAudio && (mime === "audio/mpeg" || mime === "audio/mp3" || mime === "audio/wav" || mime === "audio/x-wav" || mime === "audio/wave" || mime === "audio/vnd.wave")) {
    return true;
  }
  return new RegExp(options?.allowAudio
    ? "\\.(?:jpe?g|png|gif|webp|bmp|avif|mp4|mov|webm|mkv|m4v|mp3|wav)$"
    : "\\.(?:jpe?g|png|gif|webp|bmp|avif|mp4|mov|webm|mkv|m4v)$", "i").test(
    file.name,
  );
}

export function isToolMediaSourceItem(item: ToolMediaClientItem) {
  if (item.file || normalizeUuid(item.mediaId)) return false;
  const url = String(item.url || "").trim().replaceAll("\\", "/");
  if (!url || url.startsWith("blob:")) return false;
  return (
    url.startsWith("/uploads/")
    || url.startsWith("uploads/")
    || url.startsWith("data:")
    || /^https?:\/\//i.test(url)
  );
}

export function canStartToolMediaUpload(input: {
  hydrated: boolean;
  userId: string;
  draftSessionId: string;
  draftOwnerUserId: string;
}) {
  const userId = String(input.userId || "").trim();
  return Boolean(
    input.hydrated &&
    userId &&
    normalizeUuid(input.draftSessionId) &&
    userId === String(input.draftOwnerUserId || "").trim(),
  );
}

export async function releaseToolMediaForCurrentAccount(input: {
  ownerUserId: string;
  currentUserId: string;
  mediaIds: string[];
  release: (mediaIds: string[]) => Promise<unknown>;
}) {
  const ownerUserId = String(input.ownerUserId || "").trim();
  const currentUserId = String(input.currentUserId || "").trim();
  const mediaIds = Array.from(
    new Set(input.mediaIds.map(normalizeUuid).filter(Boolean)),
  );
  if (!ownerUserId || ownerUserId !== currentUserId || !mediaIds.length) {
    return false;
  }
  await input.release(mediaIds);
  return true;
}

function snapshotItem(item: ToolMediaClientItem) {
  const {
    replacement: _replacement,
    uploadError: _uploadError,
    uploadRequestId: _uploadRequestId,
    uploadState: _uploadState,
    ...snapshot
  } = item;
  return snapshot;
}

export function createPendingToolMediaItem(
  file: File,
  overrides: ToolMediaClientItem = {},
): ToolMediaClientItem {
  return {
    ...overrides,
    file,
    url: null,
    mediaId: undefined,
    uploadError: undefined,
    uploadRequestId: normalizeUuid(overrides.uploadRequestId) || createToolClientUuid(),
    uploadState: "queued",
  };
}

export function createPendingToolMediaReplacement(
  previousItem: ToolMediaClientItem,
  file: File,
  overrides: ToolMediaClientItem = {},
): ToolMediaClientItem {
  if (previousItem.replacement) return previousItem;
  return {
    ...createPendingToolMediaItem(file, overrides),
    replacement: {
      previousItem: snapshotItem(previousItem),
    },
  };
}

export function retryToolMediaUpload(item: ToolMediaClientItem) {
  if (!(item.file instanceof File)) return item;
  const { uploadError: _uploadError, ...rest } = item;
  return {
    ...rest,
    uploadRequestId: normalizeUuid(item.uploadRequestId) || createToolClientUuid(),
    uploadState: "queued" as const,
  };
}

export function removedToolMediaIds(
  previousItems: ToolMediaClientItem[],
  nextItems: ToolMediaClientItem[],
) {
  const nextIds = new Set(
    nextItems.map((item) => normalizeUuid(item.mediaId)).filter(Boolean),
  );
  const protectedIds = new Set(
    nextItems
      .map((item) => normalizeUuid(item.replacement?.previousItem?.mediaId))
      .filter(Boolean),
  );
  return Array.from(
    new Set(
      previousItems
        .map((item) => normalizeUuid(item.mediaId))
        .filter(
          (mediaId) =>
            mediaId && !nextIds.has(mediaId) && !protectedIds.has(mediaId),
        ),
    ),
  );
}

export function resolveToolMediaUploadCommit(
  items: ToolMediaClientItem[],
  commit: ToolMediaUploadCommit,
) {
  const stillPending = "pendingFile" in commit
    ? items.some(
        (item) =>
          item.file === commit.pendingFile && !String(item.url || "").trim(),
      )
    : items.some(
        (item) =>
          normalizeUuid(item.uploadRequestId) === commit.pendingRequestId
          && String(item.url || "").trim() === commit.pendingSourceUrl
          && !normalizeUuid(item.mediaId),
      );
  if (stillPending) {
    return { complete: false, releaseMediaIds: [] as string[] };
  }
  const readyCommitted = items.some(
    (item) => normalizeUuid(item.mediaId) === commit.readyMediaId,
  );
  return {
    complete: true,
    releaseMediaIds: readyCommitted
      ? commit.previousMediaId
        ? [commit.previousMediaId]
        : []
      : [commit.readyMediaId],
  };
}

export async function settleToolMediaUpload(input: {
  pendingItem: ToolMediaClientItem;
  upload: () => Promise<{
    mediaId?: unknown;
    localPreviewUrl?: unknown;
    modelUrl?: unknown;
    status?: unknown;
    kind?: unknown;
    sizeBytes?: unknown;
    probe?: unknown;
  }>;
}): Promise<{
  item: ToolMediaClientItem | null;
  error: unknown | null;
  commit: ToolMediaUploadCommit | null;
}> {
  let uploaded: Awaited<ReturnType<typeof input.upload>>;
  try {
    uploaded = await input.upload();
    const mediaId = normalizeUuid(uploaded.mediaId);
    const url = String(uploaded.localPreviewUrl || "").trim();
    const modelUrl = String(uploaded.modelUrl || "").trim();
    if (!mediaId || uploaded.status !== "ready" || !url || !modelUrl) {
      throw new Error("素材上传未返回 ready 状态");
    }
    const pendingFile = input.pendingItem.file;
    const pendingSourceUrl = String(input.pendingItem.url || "").trim();
    const pendingRequestId = normalizeUuid(input.pendingItem.uploadRequestId);
    const isFileUpload = pendingFile instanceof File;
    if (!isFileUpload && (!pendingSourceUrl || !pendingRequestId)) {
      throw new Error("素材上传缺少待提交来源");
    }
    const byteSize = isFileUpload ? pendingFile.size : Number(uploaded.sizeBytes);
    if (!Number.isSafeInteger(byteSize) || byteSize <= 0) {
      throw new Error("素材上传未返回有效文件大小");
    }
    const {
      replacement: _replacement,
      uploadError: _uploadError,
      ...pendingFields
    } = input.pendingItem;
    const readyItem: ToolMediaClientItem = {
      ...pendingFields,
      file: null,
      url,
      mediaId,
      ...(["image", "video", "audio"].includes(String(uploaded.kind))
        ? { kind: uploaded.kind as "image" | "video" | "audio" }
        : {}),
      ...(["image", "video", "audio"].includes(String(uploaded.kind)) || uploaded.probe
        ? { byteSize }
        : {}),
      ...(uploaded.probe && typeof uploaded.probe === "object"
        ? { probe: uploaded.probe as SeedanceMediaProbe }
        : {}),
      ...(input.pendingItem.uploadState || input.pendingItem.uploadRequestId
        ? { uploadState: "ready" as const }
        : {}),
    };
    const previousMediaId = normalizeUuid(
      input.pendingItem.replacement?.previousItem?.mediaId,
    );
    if (previousMediaId) {
      delete readyItem.paintOriginalUrl;
    }
    return {
      item: readyItem,
      error: null,
      commit: isFileUpload
        ? {
            pendingFile,
            readyMediaId: mediaId,
            ...(previousMediaId ? { previousMediaId } : {}),
          }
        : {
            pendingSourceUrl,
            pendingRequestId,
            readyMediaId: mediaId,
            ...(previousMediaId ? { previousMediaId } : {}),
          },
    };
  } catch (error) {
    const uploadError =
      error instanceof Error && error.message.trim()
        ? error.message.trim()
        : "素材上传失败";
    const fallbackItem = input.pendingItem.replacement
      ? snapshotItem(input.pendingItem.replacement.previousItem)
      : input.pendingItem;
    return {
      item: {
        ...fallbackItem,
        file: input.pendingItem.file,
        ...(input.pendingItem.replacement
          ? { replacement: input.pendingItem.replacement }
          : {}),
        ...(input.pendingItem.uploadRequestId
          ? { uploadRequestId: input.pendingItem.uploadRequestId }
          : {}),
        uploadError,
        ...(input.pendingItem.uploadState || input.pendingItem.uploadRequestId
          ? { uploadState: "failed" as const }
          : {}),
      },
      error,
      commit: null,
    };
  }
}
