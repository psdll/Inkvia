import { apiErrorMessage, apiMessage } from "@/i18n/api-message";
import { NextRequest, NextResponse } from "next/server";
import { requireAdminRequest } from "@/lib/admin-auth";
import { supportsProviderModelFetch } from "@/lib/providers/model-fetch";
import { categorizeModels, listUpstreamModels, resolveDraftTarget } from "@/lib/providers/upstream";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
  const auth = requireAdminRequest(req);
  if (!auth.ok) return json({ error: apiErrorMessage(auth.error) }, 401);
  try {
    const target = await resolveDraftTarget(await req.json().catch(() => null) || {});
    if (!target) return json({ error: apiMessage("m3b05019002fc") }, 400);
    if (!supportsProviderModelFetch(target.provider)) {
      return json({ success: false, ok: false, message: "该平台不支持拉取模型" }, 400);
    }
    const result = await listUpstreamModels(target);
    if (!result.ok) return json({ success: false, ok: false, status: result.status, message: result.message });
    return json({
      success: true,
      ok: true,
      total: result.models.length,
      models: result.models,
      grouped: categorizeModels(result.models, target.provider.id),
    });
  } catch {
    return json({ success: false, ok: false, message: "模型拉取草稿配置无效" }, 400);
  }
}
