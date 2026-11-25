export type AdminWorksPageCursor = {
  createdAt: Date;
  id: number;
};

export function encodeAdminWorksCursor(cursor: AdminWorksPageCursor): string {
  return Buffer.from(
    JSON.stringify({ createdAt: cursor.createdAt.toISOString(), id: cursor.id }),
    "utf8",
  ).toString("base64url");
}

export function decodeAdminWorksCursor(value: string): AdminWorksPageCursor {
  try {
    const parsed = JSON.parse(Buffer.from(String(value || ""), "base64url").toString("utf8")) as {
      createdAt?: unknown;
      id?: unknown;
    };
    const createdAt = new Date(String(parsed?.createdAt || ""));
    const id = Number(parsed?.id);
    if (Number.isNaN(createdAt.getTime()) || !Number.isSafeInteger(id) || id <= 0) throw new Error();
    return { createdAt, id };
  } catch {
    throw new Error("invalid cursor");
  }
}

export function buildCreatedAtCursorWhere(cursor: AdminWorksPageCursor) {
  return {
    OR: [
      { createdAt: { lt: cursor.createdAt } },
      { AND: [{ createdAt: cursor.createdAt }, { id: { lt: cursor.id } }] },
    ],
  };
}

export function splitAdminWorksPage<T extends { id: number; createdAt: Date | string }>(rows: T[], pageSize: number) {
  const safeSize = Math.max(1, Math.floor(pageSize));
  const hasMore = rows.length > safeSize;
  const items = rows.slice(0, safeSize);
  const last = items[items.length - 1];
  return {
    items,
    hasMore,
    nextCursor: hasMore && last
      ? encodeAdminWorksCursor({ createdAt: new Date(last.createdAt), id: Number(last.id) })
      : null,
  };
}

export function getAdminWorksSyncCursor<T extends { id: number; updatedAt: Date | string }>(
  rows: T[],
  fallback: Date,
) {
  let updatedAt: Date | null = null;
  let id = 0;
  for (const row of rows) {
    const candidate = new Date(row.updatedAt);
    if (Number.isNaN(candidate.getTime())) continue;
    if (!updatedAt || candidate > updatedAt || (candidate.getTime() === updatedAt.getTime() && Number(row.id) > id)) {
      updatedAt = candidate;
      id = Number(row.id);
    }
  }
  return { updatedAt: (updatedAt || fallback).toISOString(), id };
}
