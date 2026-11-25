const RESTORE_BATCH = 500;

type RowWithId = Record<string, any> & { id: number };

type RestoreModel = {
  findMany: (args: Record<string, unknown>) => Promise<RowWithId[]>;
  createMany: (args: { data: RowWithId[] }) => Promise<{ count: number }>;
  create: (args: { data: Record<string, any> }) => Promise<RowWithId>;
};

type ImportUserModel = {
  findUnique: (args: any) => Promise<Record<string, any> | null>;
  create: (args: any) => Promise<Record<string, any>>;
};

export async function resolveImportedUser(
  model: ImportUserModel,
  archivedUser: Record<string, any>,
  prepareAutoIds: () => Promise<void>,
  reservedTargetUserId?: number,
) {
  const sourceUserId = Number(archivedUser.id);
  const username = String(archivedUser.username || "").trim();
  if (!Number.isSafeInteger(sourceUserId) || sourceUserId <= 0 || !username) {
    throw new Error("user.json 数据无效，缺少 id 或 username");
  }

  const sameName = await model.findUnique({ where: { username } });
  if (sameName) {
    return { sourceUserId, targetUserId: Number(sameName.id), username, created: false };
  }

  // A normal data archive is not an account credential backup or an authorization
  // to create credentials. Establish the account through the existing registration flow.
  throw new Error("请先通过正常注册流程建立同名目标账号，再导入数据；归档中的密码、密文和登录令牌不会用于建立账号");
}

export type RestoreRowsOptions<T extends RowWithId> = {
  equivalent: (existing: RowWithId, archived: T) => boolean;
  prepareAutoIds?: () => Promise<void>;
  reuseByUniqueKey?: {
    key: (row: RowWithId) => string | null;
    findExisting: (rows: T[]) => Promise<RowWithId[]>;
  };
};

export type RestoreRowsResult = {
  restored: number;
  inserted: number;
  reused: number;
  remapped: number;
  idMap: Map<number, number>;
};

export function parseArchiveJsonRows(content: string | null | undefined, name: string): unknown[] {
  if (content == null) return [];
  try {
    const value = JSON.parse(content);
    return Array.isArray(value) ? value : value ? [value] : [];
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`${name} JSON 损坏：${detail}`);
  }
}

export function assertArchiveRowCount(
  manifest: Record<string, any>,
  key: string,
  rows: unknown[],
  name: string,
) {
  const raw = manifest?.stats?.[key];
  if (raw == null) return;
  const expected = Number(raw);
  if (!Number.isSafeInteger(expected) || expected < 0) throw new Error(`manifest 计数无效：${key}`);
  if (expected !== rows.length) {
    throw new Error(`${name} 数据不完整：manifest=${expected}，实际=${rows.length}`);
  }
}

export function mergeRestoreRowsById<T extends RowWithId>(groups: T[][]): T[] {
  const rowsById = new Map<number, T>();
  for (const rows of groups) {
    for (const row of rows) {
      const id = Number(row.id);
      if (!Number.isSafeInteger(id) || id <= 0) throw new Error("导入数据包含无效主键");
      const existing = rowsById.get(id);
      if (existing && JSON.stringify(existing) !== JSON.stringify(row)) {
        throw new Error(`导入数据同一主键内容不一致：${id}`);
      }
      if (!existing) rowsById.set(id, row);
    }
  }
  return Array.from(rowsById.values());
}

export async function restoreRowsWithId<T extends RowWithId>(
  model: RestoreModel,
  rows: T[],
  options: RestoreRowsOptions<T>,
): Promise<RestoreRowsResult> {
  const ids = rows.map((row) => Number(row.id));
  if (ids.some((id) => !Number.isSafeInteger(id) || id <= 0) || new Set(ids).size !== ids.length) {
    throw new Error("导入数据包含无效或重复的主键");
  }

  const existingById = new Map<number, RowWithId>();
  for (let index = 0; index < ids.length; index += RESTORE_BATCH) {
    const chunk = ids.slice(index, index + RESTORE_BATCH);
    const existing = await model.findMany({ where: { id: { in: chunk } } });
    for (const row of existing) existingById.set(Number(row.id), row);
  }

  const existingByUniqueKey = new Map<string, RowWithId>();
  if (options.reuseByUniqueKey) {
    const archivedKeyCounts = new Map<string, number>();
    for (const row of rows) {
      const key = options.reuseByUniqueKey.key(row);
      if (key != null) archivedKeyCounts.set(key, (archivedKeyCounts.get(key) || 0) + 1);
    }
    const ambiguousExistingKeys = new Set<string>();
    const existing = await options.reuseByUniqueKey.findExisting(rows);
    for (const row of existing) {
      const key = options.reuseByUniqueKey.key(row);
      if (key == null || archivedKeyCounts.get(key) !== 1) continue;
      if (existingByUniqueKey.has(key)) {
        existingByUniqueKey.delete(key);
        ambiguousExistingKeys.add(key);
      } else if (!ambiguousExistingKeys.has(key)) {
        existingByUniqueKey.set(key, row);
      }
    }
  }

  const preserve: T[] = [];
  const collisions: T[] = [];
  const idMap = new Map<number, number>();
  let reused = 0;

  for (const row of rows) {
    const sourceId = Number(row.id);
    const uniqueKey = options.reuseByUniqueKey?.key(row) ?? null;
    const existingByUnique = uniqueKey == null ? undefined : existingByUniqueKey.get(uniqueKey);
    if (existingByUnique) {
      reused += 1;
      idMap.set(sourceId, Number(existingByUnique.id));
      continue;
    }
    const existing = existingById.get(sourceId);
    if (!existing) {
      preserve.push(row);
      idMap.set(sourceId, sourceId);
    } else if (options.equivalent(existing, row)) {
      reused += 1;
      idMap.set(sourceId, sourceId);
    } else {
      collisions.push(row);
    }
  }

  let inserted = 0;
  for (let index = 0; index < preserve.length; index += RESTORE_BATCH) {
    const chunk = preserve.slice(index, index + RESTORE_BATCH);
    const result = await model.createMany({ data: chunk });
    if (result.count !== chunk.length) throw new Error("导入数据写入数量不完整");
    inserted += result.count;
  }

  if (collisions.length) await options.prepareAutoIds?.();

  for (const row of collisions) {
    const { id: sourceId, ...data } = row;
    const created = await model.create({ data });
    const targetId = Number(created.id);
    if (!Number.isSafeInteger(targetId) || targetId <= 0) throw new Error("导入数据主键重映射失败");
    idMap.set(Number(sourceId), targetId);
    inserted += 1;
  }

  return {
    restored: rows.length,
    inserted,
    reused,
    remapped: collisions.length,
    idMap,
  };
}
