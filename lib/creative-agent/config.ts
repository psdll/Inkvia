import "server-only";

import prisma from "@/lib/prisma";
import { getCreativeAgentChatModels, resolveCreativeAgentModel } from "./model-catalog";
import type { CreativeAgentInputOptions } from "./contracts";
import type { LlmRouteStatus } from "@/lib/llm-routing/types";
import {
  CREATIVE_AGENT_PROTOCOL_VERSION,
  type CreativeAgentCapabilities,
} from "./contracts";

export type CreativeAgentRuntimeReadiness = {
  worker: "ready" | "stale" | "missing";
  llm: LlmRouteStatus;
  ready: boolean;
  reason: string | null;
};

export function evaluateCreativeAgentRuntimeReadiness(input: {
  now: Date;
  heartbeatValue: string | null;
  llmStatus: LlmRouteStatus;
  llmProtocol?: string;
  nodeMajor: number;
}): CreativeAgentRuntimeReadiness {
  let heartbeat: { successAt?: string; protocolVersion?: number } = {};
  try {
    heartbeat = JSON.parse(input.heartbeatValue || "{}");
  } catch {
    /* Invalid heartbeat is not readiness. */
  }
  const age = input.now.getTime() - Date.parse(heartbeat?.successAt || "");
  const worker =
    heartbeat?.protocolVersion !== CREATIVE_AGENT_PROTOCOL_VERSION ||
    !Number.isFinite(age) ||
    age < -5000
      ? "missing"
      : age > 45000
        ? "stale"
        : "ready";
  const reason =
    input.nodeMajor < 20
      ? "Agent 需要 Node.js 20 或更高版本"
      : input.llmStatus !== "ready"
        ? "暂无可用的推理模型，请检查创作偏好中的模型选择及 API 配置"
        : input.llmProtocol !== "openai-chat"
          ? "当前 Agent 需要支持工具调用的 OpenAI 兼容对话模型"
          : worker !== "ready"
            ? "Agent 后台任务尚未就绪"
            : null;
  return { worker, llm: input.llmStatus, ready: reason === null, reason };
}

export async function getCreativeAgentRuntimeReadiness(model?: CreativeAgentInputOptions["model"]): Promise<CreativeAgentRuntimeReadiness> {
  const [route, row] = await Promise.all([
    model
      ? resolveCreativeAgentModel(model).then(result => ({ status: result.status, protocol: result.status === "ready" ? result.route.protocol : undefined }))
      : getCreativeAgentChatModels().then(models => ({ status: models.length ? "ready" as const : "missing-binding" as const, protocol: "openai-chat" })),
    prisma.appSetting.findUnique({
      where: { key: "creative_agent_worker_heartbeat" },
    }),
  ]);
  return evaluateCreativeAgentRuntimeReadiness({
    now: new Date(),
    heartbeatValue: row?.value || null,
    llmStatus: route.status,
    llmProtocol: route.protocol,
    nodeMajor: Number(process.versions.node.split(".")[0]),
  });
}

export async function getCreativeAgentCapabilities(model?: CreativeAgentInputOptions["model"]): Promise<CreativeAgentCapabilities> {
  // 画布和画布 Agent 都是常开的，没有开关；这里只报告运行是否就绪。
  const result = {
    protocolVersion: CREATIVE_AGENT_PROTOCOL_VERSION,
    enabled: true,
    ready: false,
    reason: null as string | null,
  };
  const readiness = await getCreativeAgentRuntimeReadiness(model);
  return { ...result, ready: readiness.ready, reason: readiness.reason };
}
