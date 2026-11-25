export type CanvasLlmSelection = { providerId: string; modelId: string };
export type CanvasLlmSelectionState<T extends CanvasLlmSelection> = {
  selection: T | undefined;
  invalidOverride: boolean;
};

const ROUTE_KEY_SEPARATOR = ":";

export function encodeCanvasLlmRouteKey(providerId: string, modelId: string): string {
  return `${encodeURIComponent(providerId)}${ROUTE_KEY_SEPARATOR}${encodeURIComponent(modelId)}`;
}

export function decodeCanvasLlmRouteKey(value: string): CanvasLlmSelection | null {
  const separator = value.indexOf(ROUTE_KEY_SEPARATOR);
  if (separator < 0) return null;
  try {
    const providerId = decodeURIComponent(value.slice(0, separator)).trim();
    const modelId = decodeURIComponent(value.slice(separator + 1)).trim();
    return providerId && modelId ? { providerId, modelId } : null;
  } catch {
    return null;
  }
}

export function getCanvasLlmSelectionState<T extends CanvasLlmSelection>(
  candidates: T[],
  override?: CanvasLlmSelection,
  legacyModel?: string,
): CanvasLlmSelectionState<T> {
  if (override) {
    const matched = candidates.find(
      (candidate) => candidate.providerId === override.providerId && candidate.modelId === override.modelId,
    );
    return { selection: matched, invalidOverride: !matched };
  }
  const legacy = String(legacyModel ?? "").trim();
  return {
    selection: legacy ? candidates.find((candidate) => candidate.modelId === legacy) : undefined,
    invalidOverride: false,
  };
}

export function resolveCanvasLlmSelection<T extends CanvasLlmSelection>(
  candidates: T[],
  override?: CanvasLlmSelection,
  legacyModel?: string,
): T | undefined {
  return getCanvasLlmSelectionState(candidates, override, legacyModel).selection;
}
