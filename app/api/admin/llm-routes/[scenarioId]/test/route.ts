import { apiErrorMessage, apiMessage } from "@/i18n/api-message";
import { NextRequest, NextResponse } from "next/server";
import { requireAdminRequest } from "@/lib/admin-auth";
import { LlmAdminRequestError, testAdminLlmRoute } from "@/lib/llm-routing/admin";
import { getPublicLlmError, LlmGatewayError } from "@/lib/llm-routing/gateway";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest, context: { params: { scenarioId: string } }) {
  const auth = requireAdminRequest(req);
  if (!auth.ok) return json({ error: apiErrorMessage(auth.error) }, 401);
  const body = await req.json().catch(() => null);
  try {
    const tested = await testAdminLlmRoute(context.params.scenarioId, body);
    return json({ success: true, result: tested.result });
  } catch (error) {
    if (error instanceof LlmAdminRequestError) {
      return json(
        { success: false, error: apiErrorMessage(error.message), status: error.code },
        error.status,
      );
    }
    if (error instanceof LlmGatewayError) {
      return json(
        { success: false, error: apiErrorMessage(getPublicLlmError(error)), status: error.kind },
        502,
      );
    }
    return json({ success: false, error: apiMessage("m8fd881009e60") }, 502);
  }
}
