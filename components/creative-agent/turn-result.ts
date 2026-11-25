import { summarizeMediaOutcomes } from "@/lib/creative-agent/media-summary";
import type { AgentViewState } from "./state";
import { splitNextSteps } from "@/lib/creative-agent/next-steps";

export function buildTurnCopyText(view: AgentViewState, runId: string, origin: string): string {
  const media = view.media.filter(item => item.runId === runId);
  const parts = view.messages.filter(message => message.runId === runId && message.role === "assistant" &&
    !(media.length && message.id === `${runId}:media:completed`)).map(message => splitNextSteps(message.text).body.trim()).filter(Boolean);
  for (const type of ["image", "video"] as const) {
    const outputs = media.filter(item => item.mediaType === type).flatMap(item => item.outputs);
    outputs.forEach((output, index) => {
      const url = new URL(output.url, origin).href;
      parts.push(`${type === "image" ? "!" : ""}[${type === "image" ? "图片" : "视频"} ${index + 1}](${url})`);
    });
  }
  const summary = summarizeMediaOutcomes(media, view.run?.id === runId ? view.run.status : undefined);
  if (summary && !parts.includes(summary)) parts.push(summary);
  return parts.join("\n\n");
}

export function getTurnFinishedAt(view: AgentViewState, runId: string): string | null {
  const dates = [view.finishedAtByRun?.[runId], ...view.messages.filter(message => message.id === `${runId}:media:completed`).map(message => message.createdAt)]
    .map(value => Date.parse(value || "")).filter(Number.isFinite);
  return dates.length ? new Date(Math.max(...dates)).toISOString() : null;
}
