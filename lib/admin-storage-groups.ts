export type AdminStorageGroupKey =
  | "creation"
  | "batch"
  | "canvas"
  | "agent"
  | "shared"
  | "system"
  | "other";

type GroupableStorageNode = {
  name: string;
  bytes: number;
};

export type AdminStorageNodeGroup<T extends GroupableStorageNode> = {
  key: AdminStorageGroupKey;
  label: string;
  count: number;
  totalBytes: number;
  nodes: T[];
};

const ADMIN_STORAGE_GROUP_DEFS = [
  {
    key: "creation",
    label: "创作",
    names: ["imports", "image_results", "video_results", "face_results"],
  },
  {
    key: "batch",
    label: "批量",
    names: ["batch_imports", "batch-image_results"],
  },
  {
    key: "canvas",
    label: "画布",
    names: ["canvas_imports", "canvas_image_results", "canvas_video_results", "canvas_audio_results", "canvas_voice_previews", "canvas-library", "canvas-workflows", "canvas-library-legacy"],
  },
  {
    key: "agent",
    label: "Agent",
    names: ["Agent_imports", "Agent_image_results", "Agent_video_results", "Agent_audio_results", "role_skill_covers", ".agent-memory"],
  },
  {
    key: "shared",
    label: "公共素材与配置",
    names: ["products", "material_library", "inspiration_assets", "presets"],
  },
  {
    key: "system",
    label: "系统辅助与缓存",
    names: ["generation_previews", "generation_posters", "_thumbs", "temp", "feedback"],
  },
  { key: "other", label: "其他目录", names: [] },
] as const;

const ADMIN_STORAGE_GROUP_KEY_BY_NAME = new Map<string, AdminStorageGroupKey>(
  ADMIN_STORAGE_GROUP_DEFS.flatMap((group) =>
    group.names.map((name) => [name, group.key] as const),
  ),
);

export function groupAdminStorageNodes<T extends GroupableStorageNode>(
  nodes: T[],
): AdminStorageNodeGroup<T>[] {
  const buckets = new Map<AdminStorageGroupKey, T[]>();

  for (const node of nodes) {
    const key = ADMIN_STORAGE_GROUP_KEY_BY_NAME.get(node.name) || "other";
    const bucket = buckets.get(key);
    if (bucket) bucket.push(node);
    else buckets.set(key, [node]);
  }

  return ADMIN_STORAGE_GROUP_DEFS.flatMap((group) => {
    const grouped = [...(buckets.get(group.key) || [])].sort((a, b) => {
      if (b.bytes !== a.bytes) return b.bytes - a.bytes;
      return a.name.localeCompare(b.name, "zh-CN");
    });
    if (!grouped.length) return [];

    return [{
      key: group.key,
      label: group.label,
      count: grouped.length,
      totalBytes: grouped.reduce((sum, node) => sum + node.bytes, 0),
      nodes: grouped,
    }];
  });
}
