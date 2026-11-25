export type GenerationTaskDeleteRow = {
  id: number;
  userId: string | null;
  authUserId: number | null;
  type: string;
  externalTaskId: string | null;
};

type FindManyDelegate = {
  findMany(args: any): PromiseLike<Array<Record<string, any>>>;
};

type GenerationTaskDeleteClient = {
  generation: FindManyDelegate;
  imageBatchOutput?: FindManyDelegate;
  liveVideoBatchOutput?: FindManyDelegate;
};

function uniqueStrings(values: unknown[]) {
  return Array.from(new Set(values.map((value) => String(value || "").trim()).filter(Boolean)));
}

function uniqueIds(values: unknown[]) {
  return Array.from(new Set(values
    .map((value) => Number(value))
    .filter((value) => Number.isSafeInteger(value) && value > 0)));
}

function taskScope(row: GenerationTaskDeleteRow) {
  const externalTaskId = String(row.externalTaskId || "").trim();
  if (!externalTaskId) return null;
  return row.authUserId != null
    ? { authUserId: row.authUserId, type: row.type, externalTaskId }
    : { authUserId: null, userId: row.userId, type: row.type, externalTaskId };
}

/**
 * Expands an administrator selection to the complete task aggregate.
 * A task is scoped by owner + type + external task id, and by image/live batch
 * item membership. Expansion is transitive because a provider task can also be
 * represented by a batch item.
 */
export async function expandGenerationTaskDeleteRows<T extends GenerationTaskDeleteRow>(
  client: GenerationTaskDeleteClient,
  initialRows: T[],
  options: { select: Record<string, boolean>; maxRows?: number },
): Promise<T[]> {
  const rowsById = new Map<number, T>();
  for (const row of initialRows) {
    if (Number.isSafeInteger(row.id) && row.id > 0) rowsById.set(row.id, row);
  }
  const maxRows = Math.max(1, Number(options.maxRows || 5000));

  for (;;) {
    const sizeBefore = rowsById.size;
    const scopes = Array.from(new Map(
      Array.from(rowsById.values())
        .map(taskScope)
        .filter((scope): scope is NonNullable<ReturnType<typeof taskScope>> => Boolean(scope))
        .map((scope) => [JSON.stringify(scope), scope]),
    ).values());
    if (scopes.length) {
      const peerRows = await client.generation.findMany({
        where: { OR: scopes },
        select: options.select,
      }) as T[];
      for (const row of peerRows) rowsById.set(row.id, row);
    }

    const currentIds = Array.from(rowsById.keys());
    const siblingIds = new Set<number>();
    if (client.imageBatchOutput) {
      const links = await client.imageBatchOutput.findMany({
        where: { generationId: { in: currentIds } },
        select: { itemId: true },
      });
      const itemIds = uniqueStrings(links.map((link) => link.itemId));
      if (itemIds.length) {
        const siblings = await client.imageBatchOutput.findMany({
          where: { itemId: { in: itemIds }, generationId: { not: null } },
          select: { generationId: true },
        });
        for (const id of uniqueIds(siblings.map((entry) => entry.generationId))) siblingIds.add(id);
      }
    }
    if (client.liveVideoBatchOutput) {
      const links = await client.liveVideoBatchOutput.findMany({
        where: { generationId: { in: currentIds } },
        select: { itemId: true },
      });
      const itemIds = uniqueStrings(links.map((link) => link.itemId));
      if (itemIds.length) {
        const siblings = await client.liveVideoBatchOutput.findMany({
          where: { itemId: { in: itemIds }, generationId: { not: null } },
          select: { generationId: true },
        });
        for (const id of uniqueIds(siblings.map((entry) => entry.generationId))) siblingIds.add(id);
      }
    }

    const missingSiblingIds = Array.from(siblingIds).filter((id) => !rowsById.has(id));
    if (missingSiblingIds.length) {
      const siblingRows = await client.generation.findMany({
        where: { id: { in: missingSiblingIds } },
        select: options.select,
      }) as T[];
      for (const row of siblingRows) rowsById.set(row.id, row);
    }

    if (rowsById.size > maxRows) {
      throw new Error(`任务关联记录超过单次删除上限 ${maxRows}`);
    }
    if (rowsById.size === sizeBefore) break;
  }

  return Array.from(rowsById.values());
}
