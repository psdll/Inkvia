import type { RolePositioningSurface } from "@/lib/role-positioning-surface";

export type ToolboxImageRoleContinuation = {
  kind: "toolbox_image_generation";
  taskId: number;
  requestKey: string;
  phase: "waiting" | "ready";
  userPrompt?: string;
};

export type ToolboxVideoRoleContinuation = {
  kind: "toolbox_video_generation";
  taskId: number;
  requestKey: string;
  phase: "waiting" | "ready";
  userPrompt?: string;
};

export type BatchSegmentedPromptRoleContinuation = {
  kind: "batch_segmented_prompts";
  taskId: number;
  requestKey: string;
  phase: "waiting" | "ready";
  templateBatchId: string;
  sharedPrompt: string;
  sharedSettings: Record<string, unknown>;
  mediaSnapshots: Array<{
    mediaId: string;
    position: number;
  }>;
};

export type RolePositioningContinuation =
  | ToolboxImageRoleContinuation
  | ToolboxVideoRoleContinuation
  | BatchSegmentedPromptRoleContinuation;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_PROMPT_LENGTH = 200_000;
const MAX_BATCH_MEDIA_SNAPSHOTS = 20;

function positiveInteger(value: unknown) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) {
    throw new Error("续跑任务编号无效");
  }
  return number;
}

function uuidValue(value: unknown, label: string) {
  const normalized = String(value || "").trim();
  if (!UUID_PATTERN.test(normalized)) {
    throw new Error(`${label}无效`);
  }
  return normalized;
}

function phaseValue(value: unknown): "waiting" | "ready" {
  if (value !== "waiting" && value !== "ready") {
    throw new Error("续跑阶段无效");
  }
  return value;
}

export function parseRolePositioningContinuation(
  value: unknown,
  surface: RolePositioningSurface,
): RolePositioningContinuation | null {
  if (value === null || value === undefined) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("续跑信息格式无效");
  }

  const input = value as Record<string, unknown>;
  const base = {
    taskId: positiveInteger(input.taskId),
    requestKey: uuidValue(input.requestKey, "续跑请求标识"),
    phase: phaseValue(input.phase),
  };

  if (
    input.kind === "toolbox_image_generation"
    || input.kind === "toolbox_video_generation"
  ) {
    const expectedSurface = input.kind === "toolbox_image_generation"
      ? "toolbox_image"
      : "toolbox_video";
    if (surface !== expectedSurface) throw new Error("续跑入口不匹配");
    const userPrompt = String(input.userPrompt || "").trim();
    if (userPrompt.length > MAX_PROMPT_LENGTH) {
      throw new Error("续跑提示词过长");
    }
    return {
      kind: input.kind,
      ...base,
      ...(userPrompt ? { userPrompt } : {}),
    };
  }

  if (input.kind === "batch_segmented_prompts") {
    if (surface !== "batch_workbench") throw new Error("续跑入口不匹配");
    if (
      !input.sharedSettings
      || typeof input.sharedSettings !== "object"
      || Array.isArray(input.sharedSettings)
      || !Array.isArray(input.mediaSnapshots)
      || input.mediaSnapshots.length > MAX_BATCH_MEDIA_SNAPSHOTS
    ) {
      throw new Error("批量续跑信息格式无效");
    }
    const sharedPrompt = String(input.sharedPrompt || "");
    if (sharedPrompt.length > MAX_PROMPT_LENGTH) {
      throw new Error("批量续跑提示词过长");
    }
    const mediaSnapshots = input.mediaSnapshots.map((snapshot) => {
      if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
        throw new Error("批量续跑素材格式无效");
      }
      const item = snapshot as Record<string, unknown>;
      const position = Number(item.position);
      if (!Number.isInteger(position) || position < 0) {
        throw new Error("批量续跑素材位置无效");
      }
      return {
        mediaId: uuidValue(item.mediaId, "批量续跑素材编号"),
        position,
      };
    });
    if (
      mediaSnapshots.some((snapshot, index) => snapshot.position !== index)
      || new Set(mediaSnapshots.map((snapshot) => snapshot.mediaId)).size
        !== mediaSnapshots.length
    ) {
      throw new Error("批量续跑素材格式无效");
    }
    return {
      kind: input.kind,
      ...base,
      templateBatchId: uuidValue(input.templateBatchId, "批量模板编号"),
      sharedPrompt,
      sharedSettings: input.sharedSettings as Record<string, unknown>,
      mediaSnapshots,
    };
  }

  throw new Error("续跑任务类型无效");
}

export function safeRolePositioningContinuation(
  value: unknown,
  surface: RolePositioningSurface,
) {
  try {
    return parseRolePositioningContinuation(value, surface);
  } catch {
    return null;
  }
}
