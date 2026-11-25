"use client";

import type {
  ToolWorkspaceMediaInput,
  ToolWorkspaceMediaSlot,
  ToolWorkspaceTool,
} from "@/lib/tool-workspace-draft/contracts";
import { createToolClientUuid } from "@/lib/tool-media/client-draft";

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TRANSIENT_KEYS = new Set([
  "file",
  "replacement",
  "uploadError",
  "uploadRequestId",
  "uploadState",
  "pending",
]);

export type ToolWorkspaceDraftMediaDto = {
  relationId: string;
  mediaId: string;
  position: number;
  slot: ToolWorkspaceMediaSlot | null;
  kind: string | null;
  status: string | null;
  originalName: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  localPreviewUrl: string | null;
  createdAt: string;
};

export type ToolWorkspaceDraftDto = {
  id: string;
  tool: ToolWorkspaceTool;
  schemaVersion: number;
  payload: Record<string, unknown>;
  version: number;
  updatedAt: string;
  media: ToolWorkspaceDraftMediaDto[];
};

export type LocalWorkspaceDraftBackup = {
  schemaVersion: 1;
  version: number;
  savedAt: string;
  payload: Record<string, unknown>;
  media: Array<{ mediaId: string; position: number; slot?: ToolWorkspaceMediaSlot }>;
};

export class ToolWorkspaceDraftClientError extends Error {
  constructor(
    message: string,
    public status: number,
    public code = "TOOL_WORKSPACE_DRAFT_REQUEST_FAILED",
  ) {
    super(message);
    this.name = "ToolWorkspaceDraftClientError";
  }
}

export type ToolWorkspaceUploadProgressState = "uploading" | "verifying";

export type ToolWorkspaceUploadOptions = {
  requestKey?: string;
  requestTimeoutMs?: number;
  verificationTimeoutMs?: number;
  verificationIntervalMs?: number;
  onStateChange?: (state: ToolWorkspaceUploadProgressState) => void;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeMediaList(value: unknown) {
  if (!Array.isArray(value)) return null;
  const normalized: LocalWorkspaceDraftBackup["media"] = [];
  const positions = new Set<number>();
  for (const candidate of value) {
    if (!isRecord(candidate)) return null;
    const mediaId = String(candidate.mediaId || "").trim().toLowerCase();
    const position = Number(candidate.position);
    const slot = candidate.slot === "first" || candidate.slot === "last"
      ? candidate.slot
      : undefined;
    if (!UUID_RE.test(mediaId) || !Number.isInteger(position) || position < 0 || positions.has(position)) {
      return null;
    }
    positions.add(position);
    normalized.push({ mediaId, position, ...(slot ? { slot } : {}) });
  }
  return normalized.sort((left, right) => left.position - right.position);
}

function sanitizeSerializable(value: unknown): unknown {
  if (typeof value === "string") {
    return value.trimStart().startsWith("blob:") ? undefined : value;
  }
  if (
    (typeof File !== "undefined" && value instanceof File)
    || (typeof Blob !== "undefined" && value instanceof Blob)
  ) {
    return undefined;
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      const sanitized = sanitizeSerializable(item);
      return sanitized === undefined ? [] : [sanitized];
    });
  }
  if (!isRecord(value)) return value;
  const sanitized: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (TRANSIENT_KEYS.has(key)) continue;
    const next = sanitizeSerializable(item);
    if (next !== undefined) sanitized[key] = next;
  }
  return sanitized;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalize(value[key])]),
  );
}

export function readLocalWorkspaceDraftBackup(
  storage: StorageLike,
  key: string,
): LocalWorkspaceDraftBackup | null {
  try {
    const parsed = JSON.parse(storage.getItem(key) || "null") as unknown;
    if (!isRecord(parsed) || parsed.schemaVersion !== 1) return null;
    const version = Number(parsed.version);
    const media = normalizeMediaList(parsed.media);
    if (
      !Number.isInteger(version)
      || version < 0
      || typeof parsed.savedAt !== "string"
      || !parsed.savedAt
      || !isRecord(parsed.payload)
      || media === null
    ) {
      return null;
    }
    return {
      schemaVersion: 1,
      version,
      savedAt: parsed.savedAt,
      payload: parsed.payload,
      media,
    };
  } catch {
    return null;
  }
}

export function writeLocalWorkspaceDraftBackup(
  storage: StorageLike,
  key: string,
  value: {
    version: number;
    savedAt?: string;
    payload: Record<string, unknown>;
    media: ToolWorkspaceMediaInput[];
  },
) {
  const media = normalizeMediaList(value.media);
  if (!media || !Number.isInteger(value.version) || value.version < 0) {
    throw new Error("本地工作草稿格式无效");
  }
  const envelope: LocalWorkspaceDraftBackup = {
    schemaVersion: 1,
    version: value.version,
    savedAt: value.savedAt || new Date().toISOString(),
    payload: value.payload,
    media,
  };
  storage.setItem(key, JSON.stringify(envelope));
  return envelope;
}

export function readLegacyToolWorkspaceMigration(input: {
  tool: ToolWorkspaceTool;
  userId: string;
  localStorage: StorageLike;
  sessionStorage: StorageLike;
}) {
  const userId = String(input.userId || "").trim();
  if (!userId) return null;
  let state: Record<string, unknown> | null = null;
  let media: LocalWorkspaceDraftBackup["media"] = [];
  try {
    const parsed = JSON.parse(
      input.localStorage.getItem(`draft_${input.tool}_v1_${userId}`) || "null",
    );
    const sanitized = sanitizeSerializable(parsed);
    if (isRecord(sanitized)) state = sanitized;
  } catch {}
  try {
    const parsed = JSON.parse(
      input.sessionStorage.getItem(`tool_media_draft_v1:${input.tool}:${userId}`) || "null",
    );
    if (isRecord(parsed)) media = normalizeMediaList(parsed.items) || [];
  } catch {}
  if (!state && !media.length) return null;
  return {
    payload: {
      schemaVersion: 1,
      tool: input.tool,
      state: state || {},
    },
    media,
  };
}

export function workspaceDraftFingerprint(
  payload: Record<string, unknown>,
  media: ToolWorkspaceMediaInput[],
) {
  return JSON.stringify(canonicalize({ payload, media }));
}

async function readApiResponse(response: Response) {
  const body = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok || body?.success === false) {
    throw new ToolWorkspaceDraftClientError(
      String(body?.error || "保存工作草稿失败"),
      response.status,
      typeof body?.code === "string" ? body.code : undefined,
    );
  }
  return body || {};
}

export async function fetchToolWorkspaceDraft(
  tool: ToolWorkspaceTool,
  fetcher: FetchLike = fetch,
) {
  const response = await fetcher(`/api/tool-workspace-drafts/${tool}`, { cache: "no-store" });
  const body = await readApiResponse(response);
  return (body.draft || null) as ToolWorkspaceDraftDto | null;
}

export async function patchToolWorkspaceDraft(
  tool: ToolWorkspaceTool,
  input: {
    accountGuardUserId: string;
    expectedVersion: number;
    payload: Record<string, unknown>;
    media?: ToolWorkspaceMediaInput[];
  },
  fetcher: FetchLike = fetch,
  requestInit: Pick<RequestInit, "keepalive"> = {},
) {
  const { accountGuardUserId, ...bodyInput } = input;
  const response = await fetcher(`/api/tool-workspace-drafts/${tool}`, {
    ...requestInit,
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      "X-Tool-Workspace-Account": accountGuardUserId,
    },
    body: JSON.stringify(bodyInput),
  });
  const body = await readApiResponse(response);
  return body.draft as ToolWorkspaceDraftDto;
}

function normalizeUploadRequestKey(value: unknown) {
  const requestKey = String(value || "").trim().toLowerCase();
  if (!UUID_RE.test(requestKey)) {
    throw new ToolWorkspaceDraftClientError(
      "素材上传请求标识无效",
      400,
      "TOOL_WORKSPACE_UPLOAD_REQUEST_KEY_INVALID",
    );
  }
  return requestKey;
}

async function fetchWithTimeout(
  fetcher: FetchLike,
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number,
) {
  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(() => {
      controller.abort();
      reject(new ToolWorkspaceDraftClientError(
        "素材上传请求超时",
        408,
        "TOOL_WORKSPACE_UPLOAD_TIMEOUT",
      ));
    }, timeoutMs);
  });
  try {
    return await Promise.race([
      fetcher(input, { ...init, signal: controller.signal }),
      timeout,
    ]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

export async function fetchToolWorkspaceMediaUploadStatus(
  tool: ToolWorkspaceTool,
  requestKey: string,
  accountGuardUserId?: string,
  fetcher: FetchLike = fetch,
) {
  const normalizedRequestKey = normalizeUploadRequestKey(requestKey);
  const params = new URLSearchParams({ requestKey: normalizedRequestKey });
  const response = await fetcher(`/api/tool-workspace-drafts/${tool}/media?${params}`, {
    cache: "no-store",
    headers: { "X-Tool-Workspace-Account": String(accountGuardUserId || "") },
  });
  return readApiResponse(response) as Promise<{
    uploadState?: "pending" | "ready" | "failed";
    relation?: ToolWorkspaceDraftMediaDto;
    version?: number;
    error?: string;
  }>;
}

export async function uploadToolWorkspaceMedia(
  tool: ToolWorkspaceTool,
  file: File,
  slot?: ToolWorkspaceMediaSlot | null,
  accountGuardUserId?: string,
  fetcher: FetchLike = fetch,
  options: ToolWorkspaceUploadOptions = {},
) {
  const requestKey = normalizeUploadRequestKey(options.requestKey || createToolClientUuid());
  const form = new FormData();
  form.set("file", file);
  if (slot) form.set("slot", slot);
  form.set("requestKey", requestKey);
  options.onStateChange?.("uploading");
  let uploadError: unknown;
  try {
    const response = await fetchWithTimeout(
      fetcher,
      `/api/tool-workspace-drafts/${tool}/media`,
      {
        method: "POST",
        headers: { "X-Tool-Workspace-Account": String(accountGuardUserId || "") },
        body: form,
      },
      Math.max(1, Number(options.requestTimeoutMs) || 60_000),
    );
    const body = await readApiResponse(response);
    return {
      relation: body.relation as ToolWorkspaceDraftMediaDto,
      version: Number(body.version),
    };
  } catch (error) {
    uploadError = error;
    if (
      error instanceof ToolWorkspaceDraftClientError
      && error.status >= 400
      && error.status < 500
      && ![408, 425, 429].includes(error.status)
    ) {
      throw error;
    }
  }

  options.onStateChange?.("verifying");
  const verificationTimeoutMs = Math.max(1, Number(options.verificationTimeoutMs) || 30_000);
  const verificationIntervalMs = Math.max(1, Number(options.verificationIntervalMs) || 1_200);
  const deadline = Date.now() + verificationTimeoutMs;
  while (Date.now() <= deadline) {
    try {
      const status = await fetchToolWorkspaceMediaUploadStatus(
        tool,
        requestKey,
        accountGuardUserId,
        fetcher,
      );
      if (status.uploadState === "ready" && status.relation) {
        return {
          relation: status.relation,
          version: Number(status.version),
        };
      }
      if (status.uploadState === "failed") {
        throw new ToolWorkspaceDraftClientError(
          String(status.error || "素材上传未完成，请重试"),
          409,
          "TOOL_WORKSPACE_UPLOAD_FAILED",
        );
      }
    } catch (error) {
      if (
        error instanceof ToolWorkspaceDraftClientError
        && (
          error.status === 401
          || error.status === 403
          || error.code === "TOOL_WORKSPACE_ACCOUNT_CHANGED"
          || error.code === "TOOL_WORKSPACE_UPLOAD_FAILED"
        )
      ) {
        throw error;
      }
    }
    if (Date.now() + verificationIntervalMs > deadline) break;
    await new Promise((resolve) => setTimeout(resolve, verificationIntervalMs));
  }
  throw new ToolWorkspaceDraftClientError(
    uploadError instanceof Error && uploadError.message
      ? `${uploadError.message}，服务端结果仍未确认，请重试`
      : "素材上传结果仍未确认，请重试",
    408,
    "TOOL_WORKSPACE_UPLOAD_UNCONFIRMED",
  );
}

export async function deleteToolWorkspaceMedia(
  tool: ToolWorkspaceTool,
  relationId: string,
  accountGuardUserId?: string,
  fetcher: FetchLike = fetch,
) {
  const response = await fetcher(
    `/api/tool-workspace-drafts/${tool}/media/${encodeURIComponent(relationId)}`,
    {
      method: "DELETE",
      headers: { "X-Tool-Workspace-Account": String(accountGuardUserId || "") },
    },
  );
  const body = await readApiResponse(response);
  return {
    detached: Boolean(body.detached),
    released: Boolean(body.released),
    version: Number(body.version),
  };
}
