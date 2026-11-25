export type BatchDownloadOutputLike = {
  slotIndex: number;
  attempt: number;
  status: string;
  generation?: { localPath?: string | null } | null;
};

export function selectLatestSuccessfulBatchOutputs<
  TItem extends { outputs: readonly BatchDownloadOutputLike[] },
>(items: readonly TItem[]): Array<{
  item: TItem;
  output: TItem["outputs"][number];
}> {
  type TOutput = TItem["outputs"][number];
  const selected: Array<{ item: TItem; output: TOutput }> = [];
  for (const item of items) {
    const latestBySlot = new Map<number, TOutput>();
    for (const output of item.outputs) {
      const current = latestBySlot.get(output.slotIndex);
      if (!current || output.attempt > current.attempt) {
        latestBySlot.set(output.slotIndex, output);
      }
    }
    for (const output of Array.from(latestBySlot.values()).sort(
      (left, right) => left.slotIndex - right.slotIndex,
    )) {
      if (
        output.status === "success"
        && String(output.generation?.localPath || "").trim()
      ) {
        selected.push({ item, output });
      }
    }
  }
  return selected;
}
