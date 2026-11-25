import { isCreativeAgentRunActive, type CreativeAgentMedia, type CreativeAgentRunStatus } from "./contracts";
import { friendlyErrorDisplayText } from "@/lib/error-friendly";

type MediaOutcome = Pick<CreativeAgentMedia, "status" | "mediaType" | "outputs" | "nodeIds" | "error" | "retryOfGenerationId" | "retryAttempt" | "retryReason"> & Partial<Pick<CreativeAgentMedia, "generationId">>;

/** Only summarize settled receipts; submission and visual quality are separate facts. */
export function summarizeMediaOutcomes(media: MediaOutcome[], runStatus?: CreativeAgentRunStatus): string | null {
  const superseded = new Set(media.flatMap(item => item.retryOfGenerationId ? [item.retryOfGenerationId] : []));
  media = media.filter(item => !item.generationId || !superseded.has(item.generationId));
  if (!media.length || media.some(item => !["success", "failed", "cancelled", "canceled"].includes(item.status) || item.status === "success" && !item.outputs.length)) return null;
  const succeeded = media.filter(item => item.status === "success");
  const failed = media.filter(item => item.status === "failed");
  const cancelled = media.length - succeeded.length - failed.length;
  const counts = [succeeded.length && `${succeeded.length} 项成功`, failed.length && `${failed.length} 项失败`, cancelled && `${cancelled} 项取消`].filter(Boolean).join("，");
  const ended = runStatus !== undefined && !isCreativeAgentRunActive(runStatus);
  const scope = ended ? runStatus === "completed" ? "本轮生成任务已结束" : "本轮运行已结束" : "当前已提交的生成任务";
  const lines = [`${scope}：${counts}。`];
  if (runStatus === "waiting_decision") lines.push("仍有后续操作等待你的确认或回答，本轮尚未结束。");
  else if (runStatus && !ended) lines.push("本轮尚未结束。");
  if (succeeded.length) {
    const quantities = (["image", "video"] as const).map(type => {
      const count = succeeded.filter(item => item.mediaType === type).reduce((sum, item) => sum + item.outputs.length, 0);
      return count ? `${count} ${type === "image" ? "张图片" : "段视频"}` : "";
    }).filter(Boolean).join("、");
    const synced = succeeded.every(item => item.outputs.every((output, index) => output.nodeId || item.nodeIds[index]));
    lines.push(`已生成 ${quantities}，${synced ? "结果已同步到画布" : "部分结果的画布位置尚未确认"}。`);
  }
  media.forEach((item, index) => {
    if (item.retryOfGenerationId) lines.push(`${item.mediaType === "video" ? "视频" : "图片"}任务 ${index + 1}首次失败：${friendlyErrorDisplayText(item.retryReason || "服务返回失败")}；${item.status === "success" ? "自动补试 1 次后成功" : "已自动补试 1 次，不再自动提交"}。`);
    if (item.status !== "success") {
      const error = item.error?.trim() || (item.status === "failed" ? "生成失败，服务未返回具体原因" : "已取消");
      const displayError = friendlyErrorDisplayText(error);
      lines.push(`${item.mediaType === "video" ? "视频" : "图片"}任务 ${index + 1}：${displayError}${displayError === error ? "。" : ""}`);
    }
  });
  if (failed.length) lines.push(`${succeeded.length ? "已保留成功的素材，" : ""}可调整要求后重试失败项。`);
  return lines.join("\n\n");
}
