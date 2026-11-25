import type {
  BatchHistoryGroup,
  BatchSettings,
} from "@/components/batch-workbench/types";

export function applyHistoryGroupSettingsPatch(
  group: BatchHistoryGroup,
  patch: Partial<BatchSettings>,
): BatchHistoryGroup {
  return {
    ...group,
    batch: {
      ...group.batch,
      status: "draft",
      finishedAt: null,
      sharedSettings: { ...group.batch.sharedSettings, ...patch },
    },
    items: group.items.map((item) => ({
      ...item,
      status: "draft",
      overrides: { ...item.overrides, ...patch },
    })),
  };
}
