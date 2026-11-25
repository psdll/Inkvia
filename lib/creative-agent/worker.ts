import "server-only";
import { getLlmThinkingCapabilities, normalizeLlmThinkingLevel, LLM_THINKING_LABELS } from "@/lib/llm-routing/reasoning";

import { randomUUID } from "node:crypto";
import prisma from "@/lib/prisma";
import { backgroundJobsAllowed, MaintenanceSubmissionError } from "@/lib/maintenance";
import { creativeAgentStore } from "./store";
import { CreativeAgentError } from "./errors";
import { HttpError } from "./store-types";
import { withCreativeDebug, recordCreativeDebug } from "./debug-trace";
import { pruneDebugRecords } from "./debug-store";

const workerId = `creative:${process.pid}:${randomUUID()}`;
const active = new Map<string, { actorUserId: number; controller: AbortController; promise: Promise<void> }>();
const leaseMs = 30_000;
let completedSinceTick = 0;
let failedSinceTick = 0;
let mediaDelivery: Promise<unknown> | undefined;

export async function runCreativeAgentWorkerTick() {
  void pruneDebugRecords();
  await prisma.appSetting.upsert({ where: { key: "creative_agent_worker_heartbeat" }, create: { key: "creative_agent_worker_heartbeat", value: JSON.stringify({ successAt: new Date().toISOString(), protocolVersion: 1 }) }, update: { value: JSON.stringify({ successAt: new Date().toISOString(), protocolVersion: 1 }) } });
  const result = { claimed: 0, completed: completedSinceTick, failed: failedSinceTick };
  completedSinceTick = 0; failedSinceTick = 0;
  try { if (!backgroundJobsAllowed()) throw new Error("maintenance"); }
  catch {
    for (const [runId, job] of active) {
      await creativeAgentStore.control(runId, job.actorUserId, randomUUID(), "pause").catch(() => undefined);
      job.controller.abort();
    }
    return result;
  }
  if (Number(process.versions.node.split(".")[0]) < 20) return result;
  const { reconcileCreativeAgentMedia } = await import("./media-delivery");
  if (!mediaDelivery) mediaDelivery = reconcileCreativeAgentMedia().catch(error => {
    console.warn("creative media reconciliation deferred", { type: error instanceof Error ? error.name : "unknown" });
  }).finally(() => { mediaDelivery = undefined; });
  await creativeAgentStore.recoverExpired();
  // 图片会在工具里等待出图（最多约 2.5 分钟），并发槽位不能太少
  const slots = Math.max(1, Math.min(16, Number(process.env.CREATIVE_AGENT_WORKER_SLOTS) || 6));
  for (let slot = active.size; slot < slots; slot++) {
    if (!backgroundJobsAllowed()) break;
    const run = await creativeAgentStore.claimRun(workerId, leaseMs);
    if (!run) break;
    result.claimed++;
    const controller = new AbortController();
    const timer = setInterval(() => {
      void creativeAgentStore.heartbeat(run.id, run.epoch, workerId, leaseMs).then(ok => { if (!ok) controller.abort(); }).catch(() => controller.abort());
    }, 5_000);
    timer.unref?.();
    const promise = withCreativeDebug({ runId: run.id, actorUserId: run.actorUserId, canvasId: run.canvasId, epoch: run.epoch }, async () => {
      try {
        recordCreativeDebug({ spanId: `run:${run.id}`, category: "run", type: "run.input", title: "收到用户输入", eventKey: "run.input", summary: { epoch: run.epoch }, detail: run.input });
        const { runCreativeAgent, resumeCompletedCreativeAgentTurn } = await import("./runner");
        if (run.input.engine === 3) {
          const [{ createCreativeAgentModelStream }, { runCreativeAgentV3 }] = await Promise.all([import("./llm-broker"), import("./v3/runner")]);
          // 编排默认不开深度思考：每步只需判断“做什么、调哪个工具”，思考会让每次调用慢 10-60 秒。
          // 用户在创作偏好里明确选了思考强度时按用户的来。
          const requested = normalizeLlmThinkingLevel(run.input.thinkingLevel);
          const options = { ...run.input, thinkingLevel: requested };
          const model = await createCreativeAgentModelStream({ actorUserId: run.actorUserId, canvasId: run.canvasId, runId: run.id, epoch: run.epoch, options });
          const thinking = getLlmThinkingCapabilities({ providerId: model.model.provider, modelId: model.model.id, protocol: "openai-chat" });
          if (requested === "default") options.thinkingLevel = thinking.thinkingLevels.includes("none") ? "none" : thinking.thinkingLevels.includes("low") ? "low" : "default";
          const announce = () => creativeAgentStore.appendEvent(run.id, run.epoch, "run.status", { status: "running", model: { providerId: model.model.provider, modelId: model.model.id }, thinkingLevel: options.thinkingLevel, reasoningControl: thinking.reasoningControl, thinkingMode: requested === "default" ? "model-default" : "explicit", thinkingLabel: LLM_THINKING_LABELS[options.thinkingLevel as keyof typeof LLM_THINKING_LABELS] ?? "模型默认" });
          await runCreativeAgentV3(run, { ...model, signal: controller.signal, announce });
        } else if (!await resumeCompletedCreativeAgentTurn(run, { signal: controller.signal })) {
          const [{ createCreativeAgentModelStream }, { executeCreativeAgentTool }, { createCreativeTools }] = await Promise.all([import("./llm-broker"), import("./canvas-tools"), import("./tools")]);
          const model = await createCreativeAgentModelStream({ actorUserId: run.actorUserId, canvasId: run.canvasId, runId: run.id, epoch: run.epoch, options: run.input });
          const thinkingLevel = normalizeLlmThinkingLevel(run.input.thinkingLevel);
          const thinking = getLlmThinkingCapabilities({ providerId: model.model.provider, modelId: model.model.id, protocol: "openai-chat" });
          await creativeAgentStore.appendEvent(run.id, run.epoch, "run.status", { status: "running", model: { providerId: model.model.provider, modelId: model.model.id }, thinkingLevel, reasoningControl: thinking.reasoningControl, thinkingMode: thinkingLevel === "default" ? "model-default" : "explicit", thinkingLabel: thinkingLevel === "default" ? "模型默认" : LLM_THINKING_LABELS[thinkingLevel] });
          const tools = createCreativeTools(run, creativeAgentStore, executeCreativeAgentTool);
          await runCreativeAgent(run, { ...model, tools, signal: controller.signal, readProjectContext: async current => { const { readCreativeProject } = await import("./project-state"); const { candidates: _candidates, ...state } = await readCreativeProject(current.actorUserId, current.canvasId, current.sessionId, undefined, false); return state; } });
        }
        if ((await creativeAgentStore.getRun(run.id)).status === "completed") completedSinceTick++;
      } catch (error) {
        if (error instanceof MaintenanceSubmissionError) {
          await creativeAgentStore.control(run.id, run.actorUserId, `maintenance:${run.id}:${run.epoch}`, "pause", run.epoch).catch(() => undefined);
          return;
        }
        failedSinceTick++;
        await creativeAgentStore.finish(run.id, run.epoch, "failed", error instanceof CreativeAgentError || error instanceof HttpError ? error.message : "Agent 未能完成本轮执行，请检查已保存的成果。").catch(() => undefined);
      } finally { clearInterval(timer); if (active.get(run.id)?.controller === controller) active.delete(run.id); }
    });
    active.set(run.id, { actorUserId: run.actorUserId, controller, promise });
  }
  return result;
}
