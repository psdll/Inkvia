type RequestKeyConflict = {
  code?: unknown;
  meta?: {
    modelName?: unknown;
    target?: unknown;
  };
};

function conflictTargets(error: RequestKeyConflict) {
  const target = error.meta?.target;
  if (Array.isArray(target)) return target.map((value) => String(value));
  if (target == null) return [];
  return [String(target)];
}

export function isGenerationRequestKeyConflict(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const candidate = error as RequestKeyConflict;
  if (candidate.code !== "P2002") return false;
  const modelName = String(candidate.meta?.modelName || "");
  const targets = conflictTargets(candidate);
  return (modelName === "" || modelName === "Generation")
    && targets.some((target) => /(?:^|_)requestKey(?:_|$)|Generation_requestKey_key/i.test(target));
}

export async function runGenerationRequestIdempotently<TExisting, TResult>(input: {
  requestKey?: string | null;
  execute: () => Promise<TResult>;
  findExisting: (requestKey: string) => Promise<TExisting | null>;
  mapExisting: (existing: TExisting) => TResult;
}) {
  const requestKey = String(input.requestKey || "").trim();
  if (!requestKey) return input.execute();

  const existing = await input.findExisting(requestKey);
  if (existing) return input.mapExisting(existing);

  try {
    return await input.execute();
  } catch (error) {
    if (!isGenerationRequestKeyConflict(error)) throw error;
    const winner = await input.findExisting(requestKey);
    if (!winner) throw error;
    return input.mapExisting(winner);
  }
}
