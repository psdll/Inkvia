import { apiErrorMessage, apiMessage } from "@/i18n/api-message";
import { NextRequest, NextResponse } from "next/server";
import { requireAdminRequest } from "@/lib/admin-auth";
import { isOssReady } from "@/lib/oss";
import { getEffectiveProviders } from "@/lib/providers/registry";
import { mediaDeliveryModeFromEnv, readMediaDeliverySetting, saveMediaDeliveryMode } from "@/lib/media-delivery/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" } as const;

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE_HEADERS });
}

async function snapshot() {
  const [setting, ossReady, providers] = await Promise.all([
    readMediaDeliverySetting(),
    isOssReady(),
    getEffectiveProviders().catch(() => []),
  ]);
  const pinned = mediaDeliveryModeFromEnv();
  return {
    ...setting,
    ...(pinned ? { mode: pinned, pinnedByEnv: true } : { pinnedByEnv: false }),
    ossReady,
    enabledPlatformIds: providers.filter((provider) => provider.enabled !== false).map((provider) => provider.id),
  };
}

export async function GET(req: NextRequest) {
  const auth = requireAdminRequest(req);
  if (!auth.ok) return json({ success: false, error: apiErrorMessage(auth.error) }, 401);
  try {
    return json({ success: true, ...await snapshot() });
  } catch {
    return json({ success: false, error: apiMessage("m98334865a37f") }, 500);
  }
}

export async function POST(req: NextRequest) {
  const auth = requireAdminRequest(req);
  if (!auth.ok) return json({ success: false, error: apiErrorMessage(auth.error) }, 401);
  const body = await req.json().catch(() => null) as { mode?: unknown } | null;
  if (body?.mode !== "platform" && body?.mode !== "oss") {
    return json({ success: false, error: apiMessage("m2d7266b9e9d6") }, 400);
  }
  try {
    await saveMediaDeliveryMode(body.mode);
    return json({ success: true, ...await snapshot() });
  } catch {
    return json({ success: false, error: apiMessage("m6cbdd4614ee3") }, 500);
  }
}
