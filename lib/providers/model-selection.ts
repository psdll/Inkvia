export type ProviderModelGroups = {
  image: string[];
  video: string[];
  chat: string[];
};

const GROUPS: (keyof ProviderModelGroups)[] = ["image", "video", "chat"];

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

export function mergeModelCandidates(
  fetched: ProviderModelGroups,
  selected: ProviderModelGroups,
): ProviderModelGroups {
  return GROUPS.reduce<ProviderModelGroups>(
    (groups, kind) => ({ ...groups, [kind]: dedupe([...fetched[kind], ...selected[kind]]) }),
    { image: [], video: [], chat: [] },
  );
}

export function countSelectedModels(groups: ProviderModelGroups): number {
  return GROUPS.reduce((total, kind) => total + groups[kind].length, 0);
}
