import prisma from "@/lib/prisma";
import { isRetiredProviderModel } from "@/lib/providers/retired-models";
import {
  BILLING_SETTING_KEY,
  EMPTY_BILLING_SETTINGS,
  type BillingSettings,
} from "./money";

export async function readBillingSettings(
  db: any = prisma,
): Promise<BillingSettings> {
  const row = await db.appSetting.findUnique({
    where: { key: BILLING_SETTING_KEY },
  });
  if (!row) return { ...EMPTY_BILLING_SETTINGS, rates: [] };
  const parsed = JSON.parse(row.value);
  if (
    !Array.isArray(parsed.rates) ||
    !["observe", "strict"].includes(parsed.mode)
  )
    throw new Error("计费设置损坏，请联系管理员");
  // Old saved drafts must not restore removed platforms or models.
  if (Array.isArray(parsed.drafts)) {
    parsed.drafts = parsed.drafts.filter(
      (draft: import("./drafts").PriceDraft) =>
        draft.provider !== "easyrouter" &&
        (!["volcengine", "kie"].includes(draft.provider) || !isRetiredProviderModel(draft.provider, draft.model)) &&
        // Omni has implicit cache pricing only. Drop the obsolete empty placeholder,
        // preserving every draft containing a filled price or another billing item.
        !(draft.provider === "bailian" && draft.model === "qwen3.8-omni-flash" &&
          draft.rows?.length > 0 && draft.rows.every(row => row.unitType === "cache_creation_million_token" && row.price === "")),
    );
  }
  return parsed;
}

// Serialize configuration changes across processes; no schema migration or business-row backfill.
export async function withBillingWrite<T>(
  work: (db: any) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(22092026)::text`;
      return work(tx);
    },
    { timeout: 30000 },
  );
}
