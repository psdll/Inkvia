export type HistoryCursor = {
  createdAt: Date;
  id: number;
};

export function encodeHistoryCursor(cursor: HistoryCursor): string {
  return Buffer.from(
    JSON.stringify({ createdAt: cursor.createdAt.toISOString(), id: cursor.id }),
    "utf8",
  ).toString("base64url");
}

export function decodeHistoryCursor(value: string): HistoryCursor {
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

export function buildHistoryCursorWhere(cursor: HistoryCursor) {
  return {
    OR: [
      { createdAt: { lt: cursor.createdAt } },
      { AND: [{ createdAt: cursor.createdAt }, { id: { lt: cursor.id } }] },
    ],
  };
}

export function splitHistoryPage<T extends { id: number; createdAt: Date | string }>(rows: T[], pageSize: number) {
  const safeSize = Math.max(1, Math.floor(pageSize));
  const hasMore = rows.length > safeSize;
  const items = rows.slice(0, safeSize);
  const last = items[items.length - 1];
  return {
    items,
    hasMore,
    nextCursor: hasMore && last
      ? encodeHistoryCursor({ createdAt: new Date(last.createdAt), id: Number(last.id) })
      : null,
  };
}
