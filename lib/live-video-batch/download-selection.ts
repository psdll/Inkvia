export type LiveVideoDownloadOutputLike = {
  attempt: number;
  status: string;
  generation?: { localPath?: string | null } | null;
};

function isDownloadableMp4(output: LiveVideoDownloadOutputLike) {
  const localPath = String(output.generation?.localPath || "")
    .trim()
    .replaceAll("\\", "/")
    .split("?")[0]
    .split("#")[0];
  return output.status === "success"
    && localPath.startsWith("/uploads/")
    && localPath.toLowerCase().endsWith(".mp4");
}

export function selectLatestSuccessfulLiveVideoOutputs<
  TItem extends { outputs: readonly LiveVideoDownloadOutputLike[] },
>(items: readonly TItem[]): Array<{
  item: TItem;
  output: TItem["outputs"][number];
}> {
  const selected: Array<{
    item: TItem;
    output: TItem["outputs"][number];
  }> = [];

  for (const item of items) {
    const output = [...item.outputs]
      .filter(isDownloadableMp4)
      .sort((left, right) => right.attempt - left.attempt)[0];
    if (output) selected.push({ item, output });
  }

  return selected;
}
