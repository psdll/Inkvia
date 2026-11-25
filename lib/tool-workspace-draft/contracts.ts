export const TOOL_WORKSPACE_DRAFT_PAYLOAD_MAX_BYTES = 64 * 1024;

export type ToolWorkspaceTool = "image" | "video";

export type ToolWorkspaceMediaSlot = "first" | "last";

export type ToolWorkspaceMediaInput = {
  mediaId: string;
  position: number;
  slot?: ToolWorkspaceMediaSlot | null;
};

export class ToolWorkspaceDraftError extends Error {
  constructor(
    message: string,
    public status = 400,
    public code = "TOOL_WORKSPACE_DRAFT_INVALID",
  ) {
    super(message);
    this.name = "ToolWorkspaceDraftError";
  }
}

export function normalizeToolWorkspaceTool(value: unknown): ToolWorkspaceTool {
  const tool = String(value || "").trim().toLowerCase();
  if (tool === "image" || tool === "video") return tool;
  throw new ToolWorkspaceDraftError(
    "工具类型无效",
    400,
    "TOOL_WORKSPACE_TOOL_INVALID",
  );
}

export function getToolWorkspaceMediaLimit(tool: ToolWorkspaceTool) {
  return null;
}
