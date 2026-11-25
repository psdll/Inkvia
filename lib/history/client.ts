import type { HistoryStatusRecord } from "@/lib/history/status";

export type HistoryStatusRequest = {
  ids?: number[];
  type?: string;
  source?: "all" | "tool" | "agent";
  status?: "in_progress";
  signal?: AbortSignal;
};

const SHARED_STATUS_FRESH_MS = 1_000;
const SHARED_STATUS_CACHE_LIMIT = 256;
type SharedStatusEntry = {
  expiresAt: number;
  promise: Promise<HistoryStatusRecord | null>;
};
const sharedStatusById = new Map<number, SharedStatusEntry>();

export function buildHistoryStatusUrl(input: Omit<HistoryStatusRequest, "signal">): string {
  const params = new URLSearchParams();
  params.set("view", "status");
  if (input.ids?.length) params.set("ids", input.ids.join(","));
  if (input.type) params.set("type", input.type);
  if (input.source) params.set("source", input.source);
  if (input.status) params.set("status", input.status);
  return `/api/history?${params.toString()}`;
}

async function requestHistoryStatuses(input: HistoryStatusRequest): Promise<HistoryStatusRecord[]> {
  const response = await fetch(buildHistoryStatusUrl(input), {
    cache: "no-store",
    signal: input.signal,
  });
  if (!response.ok) throw new Error(`history status ${response.status}`);
  const body = (await response.json().catch(() => null)) as { items?: unknown } | null;
  return Array.isArray(body?.items) ? (body.items as HistoryStatusRecord[]) : [];
}

export async function fetchHistoryStatuses(input: HistoryStatusRequest): Promise<HistoryStatusRecord[]> {
  const ids = Array.from(new Set((input.ids || []).filter((id) => Number.isFinite(id))));
  const canShare = ids.length > 0 && input.source === "all" && !input.type && !input.status && !input.signal;
  if (!canShare) return requestHistoryStatuses(input);

  const now = Date.now();
  for (const [id, entry] of sharedStatusById) {
    if (entry.expiresAt <= now) sharedStatusById.delete(id);
  }

  const cachedEntries = ids.map((id) => sharedStatusById.get(id));
  if (cachedEntries.every((entry): entry is SharedStatusEntry => Boolean(entry))) {
    const items = await Promise.all(cachedEntries.map((entry) => entry.promise));
    return items.filter((item): item is HistoryStatusRecord => item !== null);
  }

  while (sharedStatusById.size + ids.length > SHARED_STATUS_CACHE_LIMIT) {
    const oldestId = sharedStatusById.keys().next().value as number | undefined;
    if (oldestId === undefined) break;
    sharedStatusById.delete(oldestId);
  }

  const request = requestHistoryStatuses({ ...input, ids });
  const recordsById = request.then((items) => new Map(items.map((item) => [Number(item.id), item])));
  ids.forEach((id) => {
    const entry: SharedStatusEntry = {
      expiresAt: Number.POSITIVE_INFINITY,
      promise: recordsById.then((items) => items.get(id) || null),
    };
    sharedStatusById.set(id, entry);
    entry.promise.then(
      () => {
        if (sharedStatusById.get(id) === entry) entry.expiresAt = Date.now() + SHARED_STATUS_FRESH_MS;
      },
      () => {
        if (sharedStatusById.get(id) === entry) sharedStatusById.delete(id);
      },
    );
  });
  return request;
}
