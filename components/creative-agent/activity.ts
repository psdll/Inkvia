import type { AgentViewState } from "./state";
import { creativeSkillActivityLabel } from "@/lib/creative-agent/tool-presentation";

const stages: Record<string, string> = {
  "project.read": "正在梳理已有要求", "history.read": "正在核对之前的要求",
  "canvas.read": "正在查看画布素材", "media.inspect": "正在查看参考素材",
  "generation.models": "正在核对可用模型", "model.guidance": "正在准备生成方案",
  "creative.method": "正在准备创作方案", skillOperator: "正在准备创作方案",
  "project.progress": "正在整理创作方案", "project.update": "正在保存确认内容",
  "canvas.create": "正在添加画布内容", "canvas.patch": "正在修改画布内容",
  "canvas.focus": "正在定位画布素材", "artifact.review": "正在核对作品内容",
  "image.generate": "正在提交图片生成", "video.generate": "正在提交视频生成",
  "image.plan": "正在构思画面", "video.plan": "正在构思视频", "canvas.plan": "正在整理画布内容",
  "generation.read": "正在获取生成结果", "user.ask": "正在整理需要确认的问题",
  "media.analyze": "正在拆解视频的镜头和台词", "video.compose": "正在合成成片", "trends.read": "正在查看当前热点", "media.view": "正在查看素材画面",
};

/** Describe recorded activity only; requested outputs are not submitted tasks. */
export function describeAgentActivity(view: AgentViewState): { label: string; detail?: string } | null {
  const run = view.run;
  if (!run || !["running", "waiting_action"].includes(run.status)) return null;
  const media = [...new Map(view.media.filter(item => item.runId === run.id).map(item => [item.generationId, item])).values()];
  if (media.length) {
    const pending = media.filter(item => ["pending", "queued", "running", "processing"].includes(item.status)).length;
    const complete = media.filter(item => item.status === "success").length;
    const failed = media.filter(item => item.status === "failed").length;
    const cancelled = media.filter(item => ["cancelled", "canceled"].includes(item.status)).length;
    const kind = media.every(item => item.mediaType === "image") ? "图片" : media.every(item => item.mediaType === "video") ? "视频" : "素材";
    return { label: pending ? `正在生成${kind}` : "正在整理生成结果",
      detail: [`${media.length} 项任务`, complete && `${complete} 项完成`, pending && `${pending} 项进行中`, failed && `${failed} 项失败`, cancelled && `${cancelled} 项取消`].filter(Boolean).join(" · ") };
  }
  if (run.status === "waiting_action") return { label: "正在等待任务结果" };
  const tools = view.tools.filter(tool => tool.runId === run.id);
  const running = tools.findLast(tool => tool.status === "running");
  if (running?.activity) return {label:creativeSkillActivityLabel(running.activity, "running")};
  if (running) return { label: stages[running.name || ""] || "正在处理创作任务" };
  if (view.messages.some(message => message.runId === run.id && message.role === "assistant" && message.text.trim() && !view.completedIds.includes(message.id))) return { label: "正在撰写回复" };
  return { label: tools.length ? "正在整理创作方案" : "正在理解你的需求" };
}
