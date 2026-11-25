export const GENERATION_FINALIZE_FRESH_AGE_MS = 60 * 1000;
export const GENERATION_FINALIZE_BACKOFF_MS = 2 * 1000;

export function buildGenerationFinalizeCandidateQuery(
  now: Date,
  input: {
    providers: readonly string[];
    statuses: readonly string[];
    take?: number;
  },
) {
  const take = Math.max(1, Math.min(100, Math.trunc(input.take || 10)));
  return {
    where: {
      status: { in: [...input.statuses] },
      localPath: null,
      AND: [{ OR: [
        { externalProvider: { in: [...input.providers] } },
        { templateData: { contains: '"agentOutputRecovery":' } },
      ] }],
      OR: [
        {
          createdAt: {
            gte: new Date(now.getTime() - GENERATION_FINALIZE_FRESH_AGE_MS),
          },
        },
        {
          updatedAt: {
            lte: new Date(now.getTime() - GENERATION_FINALIZE_BACKOFF_MS),
          },
        },
      ],
    },
    orderBy: [
      { updatedAt: "asc" as const },
      { createdAt: "asc" as const },
    ],
    take,
    select: {
      id: true,
      createdAt: true,
    },
  };
}

export function buildGenerationStaleCandidateQuery(
  now: Date,
  input: {
    statuses: readonly string[];
    imageMaxAgeMs: number;
    defaultMaxAgeMs: number;
    take?: number;
  },
) {
  const take = Math.max(1, Math.min(500, Math.trunc(input.take || 50)));
  return {
    where: {
      status: { in: [...input.statuses] },
      localPath: null,
      OR: [
        {
          type: "image_edit",
          createdAt: {
            lte: new Date(now.getTime() - input.imageMaxAgeMs),
          },
        },
        {
          type: { not: "image_edit" },
          createdAt: {
            lte: new Date(now.getTime() - input.defaultMaxAgeMs),
          },
        },
      ],
    },
    orderBy: [
      { createdAt: "asc" as const },
      { id: "asc" as const },
    ],
    take,
    select: {
      id: true,
    },
  };
}
