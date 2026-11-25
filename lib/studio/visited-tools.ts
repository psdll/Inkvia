export type StudioTool = "image" | "video";

export function visitStudioTool(previous: Set<StudioTool>, tool: StudioTool): Set<StudioTool> {
  if (previous.has(tool)) return previous;
  return new Set([...previous, tool]);
}
