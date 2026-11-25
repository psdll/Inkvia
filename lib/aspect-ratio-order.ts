const ASPECT_RATIO_DISPLAY_ORDER = [
  "1:1", "1:2", "2:1", "9:16", "16:9", "3:4", "4:3",
  "3:2", "2:3", "5:4", "4:5", "21:9", "9:21",
];

function displayRank(value: string): number {
  if (value === "auto" || value === "adaptive") return -1;
  const index = ASPECT_RATIO_DISPLAY_ORDER.indexOf(value);
  return index < 0 ? ASPECT_RATIO_DISPLAY_ORDER.length : index;
}

// Sort only for display: preserve model capabilities, option metadata and defaults.
// Ratios outside the reference order retain their relative order at the end.
export function sortAspectRatioOptions<T extends { value: string }>(options: readonly T[]): T[] {
  return [...options].sort((a, b) => displayRank(a.value) - displayRank(b.value));
}
