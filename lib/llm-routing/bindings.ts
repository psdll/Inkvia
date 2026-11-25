import "server-only";

import prisma from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { getLlmScenario } from "./scenarios";
import type { LlmRouteBinding, LlmScenarioId } from "./types";

export type LlmBindingClient = Pick<Prisma.TransactionClient, "appSetting">;

function normalizeBinding(value: unknown): LlmRouteBinding | null {
  if (!value || typeof value !== "object") return null;
  const version = (value as { version?: unknown }).version;
  if (version !== undefined && version !== 1 && version !== 2) return null;
  const providerId = String((value as LlmRouteBinding).providerId ?? "").trim();
  const modelId = String((value as LlmRouteBinding).modelId ?? "").trim();
  if (!providerId || !modelId) return null;
  if (version === 2) {
    const networkRevision = String((value as LlmRouteBinding).networkRevision ?? "").trim();
    if (!/^sha256:[a-f0-9]{64}$/.test(networkRevision)) return null;
    return { providerId, modelId, networkRevision };
  }
  return { providerId, modelId };
}

export async function getLlmRouteBinding(
  scenarioId: LlmScenarioId,
  client: LlmBindingClient = prisma,
): Promise<LlmRouteBinding | null> {
  // Agent models are selected per conversation; ignore retired global bindings.
  if (scenarioId === "agent.chat") return null;
  const key = getLlmScenario(scenarioId).settingKey;
  const row = await client.appSetting.findUnique({ where: { key } });
  if (!row?.value) return null;
  try {
    return normalizeBinding(JSON.parse(row.value));
  } catch {
    return null;
  }
}

export async function saveLlmRouteBinding(
  scenarioId: LlmScenarioId,
  binding: LlmRouteBinding,
  client: LlmBindingClient = prisma,
): Promise<void> {
  if (scenarioId === "agent.chat") throw new Error("Agent 不支持平台默认模型绑定");
  const key = getLlmScenario(scenarioId).settingKey;
  const version = String(binding.networkRevision ?? "").trim() ? 2 : 1;
  const normalized = normalizeBinding({ version, ...binding });
  if (!normalized) throw new Error("Invalid LLM route binding");
  const value = JSON.stringify({ version, ...normalized });
  await client.appSetting.upsert({
    where: { key },
    create: { key, value },
    update: { value },
  });
}
