import { TOOLBOX_MODEL_DEFINITIONS } from "@/lib/toolbox-models";
import prisma from "@/lib/prisma";
import { getBillingCatalog } from "./catalog";
import { readBillingSettings } from "./settings";

export async function assertBillingReady(model: string, provider?: string) {
  const settings = await readBillingSettings();
  if (settings.mode !== "strict") return;
  const providerId =
    provider || TOOLBOX_MODEL_DEFINITIONS.find((m) => m.id === model)?.provider;
  const entry = (
    await getBillingCatalog(settings, new Date(), prisma, {
      model,
      provider: providerId || "",
    })
  ).find((m) => m.model === model && m.provider === providerId);
  if (!entry?.complete)
    throw new Error(
      `模型 ${entry?.label || model} 尚未配齐价格或人民币换算规则，请联系管理员`,
    );
}
