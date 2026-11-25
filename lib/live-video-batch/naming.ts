export function nextLiveVideoBatchName(batches: Array<{ name: string }>) {
  const highest = batches.reduce((current, batch) => {
    const match = /^分组#(\d+)$/.exec(String(batch.name || "").trim());
    return match ? Math.max(current, Number(match[1]) || 0) : current;
  }, 0);
  return `分组#${highest + 1}`;
}
