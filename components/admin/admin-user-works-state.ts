export type AdminWorksCursor = {
  updatedAt: string;
  id: number;
  sourceEventId?: number;
};

export type AdminWorksRequest = {
  sequence: number;
  scopeKey: string;
  controller: AbortController;
};

export class AdminWorksRequestGate {
  private sequence = 0;
  private current: AdminWorksRequest | null = null;

  begin(scopeKey: string): AdminWorksRequest {
    this.current?.controller.abort();
    const request = {
      sequence: ++this.sequence,
      scopeKey,
      controller: new AbortController(),
    };
    this.current = request;
    return request;
  }

  accepts(request: AdminWorksRequest, responseScopeKey: string): boolean {
    return (
      !request.controller.signal.aborted &&
      this.current?.sequence === request.sequence &&
      this.current.scopeKey === request.scopeKey &&
      responseScopeKey === request.scopeKey
    );
  }

  cancel(): void {
    this.current?.controller.abort();
    this.current = null;
  }
}

type CacheEntry<T> = {
  payload: T;
  cursor: AdminWorksCursor;
  cachedAt: number;
};

export class AdminUserWorksCache<T> {
  private readonly entries = new Map<string, CacheEntry<T>>();
  private readonly users = new Map<string, true>();
  private readonly ttlMs: number;
  private readonly maxUsers: number;
  private readonly maxItems: number;

  constructor(options: { ttlMs: number; maxUsers: number; maxItems?: number }) {
    this.ttlMs = Math.max(0, options.ttlMs);
    this.maxUsers = Math.max(1, Math.floor(options.maxUsers));
    this.maxItems = options.maxItems ?? 240;
  }

  get size(): number {
    return this.users.size;
  }

  private userKey(scopeKey: string): string {
    return scopeKey.split("|", 1)[0];
  }

  private touchUser(scopeKey: string): void {
    const userKey = this.userKey(scopeKey);
    this.users.delete(userKey);
    this.users.set(userKey, true);
  }

  private removeUserIfEmpty(userKey: string): void {
    if (!Array.from(this.entries.keys()).some((key) => this.userKey(key) === userKey)) {
      this.users.delete(userKey);
    }
  }

  get(scopeKey: string, now = Date.now()): CacheEntry<T> | null {
    const entry = this.entries.get(scopeKey);
    if (!entry) return null;
    if (now - entry.cachedAt >= this.ttlMs) {
      this.entries.delete(scopeKey);
      this.removeUserIfEmpty(this.userKey(scopeKey));
      return null;
    }
    this.entries.delete(scopeKey);
    this.entries.set(scopeKey, entry);
    this.touchUser(scopeKey);
    return entry;
  }

  set(scopeKey: string, payload: T, cursor: AdminWorksCursor, cachedAt = Date.now()): void {
    // Long browsing sessions retain only the active feed, not copies for every user/filter.
    const items = (payload as { generations?: unknown[] })?.generations;
    if (Array.isArray(items) && items.length > this.maxItems) {
      this.delete(scopeKey);
      return;
    }
    this.entries.delete(scopeKey);
    this.entries.set(scopeKey, { payload, cursor, cachedAt });
    this.touchUser(scopeKey);
    while (this.entries.size > this.maxUsers * 3) {
      const oldest = this.entries.keys().next().value!;
      this.entries.delete(oldest); this.removeUserIfEmpty(this.userKey(oldest));
    }
    while (this.users.size > this.maxUsers) {
      const oldestUser = this.users.keys().next().value as string | undefined;
      if (!oldestUser) break;
      this.users.delete(oldestUser);
      for (const key of Array.from(this.entries.keys())) {
        if (this.userKey(key) === oldestUser) this.entries.delete(key);
      }
    }
  }

  delete(scopeKey: string): void {
    this.entries.delete(scopeKey);
    this.removeUserIfEmpty(this.userKey(scopeKey));
  }

  clear(): void {
    this.entries.clear();
    this.users.clear();
  }
}

export function buildAdminWorksChangesQuery(cursor: AdminWorksCursor | null): URLSearchParams | null {
  if (!cursor?.updatedAt || !Number.isInteger(cursor.id) || cursor.id < 0) return null;
  const updatedAt = new Date(cursor.updatedAt);
  if (Number.isNaN(updatedAt.getTime())) return null;
  const query = new URLSearchParams({
    sinceUpdatedAt: updatedAt.toISOString(),
    sinceId: String(cursor.id),
  });
  if (Number.isSafeInteger(cursor.sourceEventId) && Number(cursor.sourceEventId) >= 0) {
    query.set("sinceSourceEventId", String(cursor.sourceEventId));
  }
  return query;
}

export async function loadAllFailedWorkIds(
  adminKey: string,
  fetcher: (input: string | URL | Request, init?: RequestInit) => Promise<Response> = fetch,
): Promise<number[]> {
  const query = new URLSearchParams({
    adminKey,
    failedIdsOnly: "1",
  });
  const response = await fetcher(`/api/admin/user/works?${query.toString()}`, { cache: "no-store" });
  if (!response.ok) throw new Error("加载用户失败任务失败");
  const payload = await response.json().catch(() => null) as {
    scopeKey?: string;
    failedIds?: unknown[];
  } | null;
  if (!payload || payload.scopeKey !== adminKey) throw new Error("用户失败任务范围不匹配");
  return Array.from(new Set(
    (Array.isArray(payload.failedIds) ? payload.failedIds : [])
      .map((id) => Number(id))
      .filter((id) => Number.isSafeInteger(id) && id > 0),
  ));
}

export function parseAdminWorksCursor(value: unknown): AdminWorksCursor | null {
  if (!value || typeof value !== "object") return null;
  const cursor = value as Record<string, unknown>;
  const updatedAt = typeof cursor.updatedAt === "string" ? new Date(cursor.updatedAt) : null;
  const id = Number(cursor.id);
  if (!updatedAt || Number.isNaN(updatedAt.getTime()) || !Number.isSafeInteger(id) || id < 0) return null;
  const sourceEventId = Number(cursor.sourceEventId);
  return {
    updatedAt: updatedAt.toISOString(),
    id,
    ...(Number.isSafeInteger(sourceEventId) && sourceEventId >= 0 ? { sourceEventId } : {}),
  };
}

export function canStartAdminWorksPolling(input: {
  activeAdminKey: string;
  typeFilter: string;
  sourceFilter?: string;
  loadedScopeKey: string | null;
  payloadScopeKey?: string | null;
  cursor: AdminWorksCursor | null;
}): boolean {
  const expectedScopeKey = input.sourceFilter
    ? `${input.activeAdminKey}|${input.typeFilter}|${input.sourceFilter}`
    : `${input.activeAdminKey}|${input.typeFilter}`;
  return Boolean(
    input.activeAdminKey &&
      input.loadedScopeKey === expectedScopeKey &&
      input.payloadScopeKey === input.activeAdminKey &&
      buildAdminWorksChangesQuery(input.cursor),
  );
}

function workTime(item: { finishedAt?: string | Date | null; createdAt: string | Date }): number {
  const value = new Date(item.finishedAt || item.createdAt).getTime();
  return Number.isNaN(value) ? 0 : value;
}

function updatedTime(item: { updatedAt?: string | Date | null; finishedAt?: string | Date | null; createdAt: string | Date }): number {
  const value = new Date(item.updatedAt || item.finishedAt || item.createdAt).getTime();
  return Number.isNaN(value) ? 0 : value;
}

export function mergeAdminWorks<T extends {
  id: number;
  createdAt: string | Date;
  finishedAt?: string | Date | null;
  updatedAt?: string | Date | null;
}>(current: T[], incoming: T[], limit = 40): T[] {
  const byId = new Map<number, T>();
  for (const item of current) byId.set(Number(item.id), item);
  for (const item of incoming) {
    const id = Number(item.id);
    if (!Number.isFinite(id)) continue;
    const previous = byId.get(id);
    if (!previous || updatedTime(item) >= updatedTime(previous)) byId.set(id, item);
  }
  return Array.from(byId.values())
    .sort((left, right) => workTime(right) - workTime(left) || Number(right.id) - Number(left.id))
    .slice(0, Math.max(1, Math.floor(limit)));
}

export function appendAdminWorksPage<T extends {
  id: number;
  createdAt: string | Date;
  finishedAt?: string | Date | null;
  updatedAt?: string | Date | null;
}>(current: T[], incoming: T[]): T[] {
  const result = [...current];
  const positions = new Map(current.map((item, index) => [item.id, index]));
  for (const item of incoming) {
    const index = positions.get(item.id);
    if (index === undefined) {
      positions.set(item.id, result.length);
      result.push(item);
    } else if (updatedTime(item) >= updatedTime(result[index])) {
      result[index] = item;
    }
  }
  return result;
}
