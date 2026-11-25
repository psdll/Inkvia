import "server-only";

import type { MediaDeliveryMode } from "./catalog";

export const MEDIA_DELIVERY_SETTING_KEY = "media.delivery.v1";
/** Platform hosting first; the Aliyun OSS relay covers everything a platform cannot host. */
export const DEFAULT_MEDIA_DELIVERY_MODE: MediaDeliveryMode = "platform";

async function db() {
  return (await import("@/lib/prisma")).default;
}

const CACHE_MS = 10_000;
let cached: { mode: MediaDeliveryMode; at: number } | null = null;

export function normalizeMediaDeliveryMode(value: unknown): MediaDeliveryMode {
  return value === "oss" ? "oss" : value === "platform" ? "platform" : DEFAULT_MEDIA_DELIVERY_MODE;
}

/** A deployment can pin the mode with MEDIA_DELIVERY_MODE=platform|oss; the admin switch is then informational. */
export function mediaDeliveryModeFromEnv(): MediaDeliveryMode | null {
  const value = String(process.env.MEDIA_DELIVERY_MODE || "").trim().toLowerCase();
  return value === "platform" || value === "oss" ? value : null;
}

export async function getMediaDeliveryMode(): Promise<MediaDeliveryMode> {
  const pinned = mediaDeliveryModeFromEnv();
  if (pinned) return pinned;
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.mode;
  let mode = DEFAULT_MEDIA_DELIVERY_MODE;
  try {
    const row = await (await db()).appSetting.findUnique({ where: { key: MEDIA_DELIVERY_SETTING_KEY } });
    if (row?.value) mode = normalizeMediaDeliveryMode(JSON.parse(row.value)?.mode);
  } catch {
    // An unreadable setting keeps the default instead of blocking generation.
  }
  cached = { mode, at: Date.now() };
  return mode;
}

export async function saveMediaDeliveryMode(mode: MediaDeliveryMode) {
  const value = JSON.stringify({ mode: normalizeMediaDeliveryMode(mode) });
  const row = await (await db()).appSetting.upsert({
    where: { key: MEDIA_DELIVERY_SETTING_KEY },
    create: { key: MEDIA_DELIVERY_SETTING_KEY, value },
    update: { value },
  });
  cached = null;
  return { mode: normalizeMediaDeliveryMode(JSON.parse(row.value).mode), updatedAt: row.updatedAt.toISOString() };
}

export async function readMediaDeliverySetting() {
  const row = await (await db()).appSetting.findUnique({ where: { key: MEDIA_DELIVERY_SETTING_KEY } }).catch(() => null);
  return {
    mode: row?.value ? normalizeMediaDeliveryMode(JSON.parse(row.value)?.mode) : DEFAULT_MEDIA_DELIVERY_MODE,
    updatedAt: row?.updatedAt ? row.updatedAt.toISOString() : null,
  };
}
