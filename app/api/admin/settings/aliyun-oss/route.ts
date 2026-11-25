import { apiErrorMessage, apiMessage } from "@/i18n/api-message";
import { NextRequest, NextResponse } from "next/server";
import { requireAdminRequest } from "@/lib/admin-auth";
import {
  OssConfigValidationError,
  buildOssConfigCandidate,
  getOssConfigSafeSnapshot,
  saveOssConfig,
  toSafeOssConnectionError,
  validateOssConnection,
  type OssConfigInput,
} from "@/lib/oss-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" } as const;

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: NO_STORE_HEADERS,
  });
}

export async function GET(req: NextRequest) {
  const auth = requireAdminRequest(req);
  if (!auth.ok) {
    return json({ success: false, error: apiErrorMessage(auth.error) }, 401);
  }

  try {
    return json({
      success: true,
      ...await getOssConfigSafeSnapshot(),
    });
  } catch {
    return json({ success: false, error: apiMessage("mc6d24230a8dd") }, 500);
  }
}

export async function POST(req: NextRequest) {
  const auth = requireAdminRequest(req);
  if (!auth.ok) {
    return json({ success: false, error: apiErrorMessage(auth.error) }, 401);
  }

  const body = await req.json().catch(() => null) as {
    config?: OssConfigInput;
  } | null;
  if (!body?.config || typeof body.config !== "object") {
    return json({ success: false, error: apiMessage("m3bc2b5b25e29") }, 400);
  }

  let candidate;
  try {
    candidate = await buildOssConfigCandidate(body.config);
  } catch (error) {
    if (error instanceof OssConfigValidationError) {
      return json({ success: false, error: apiErrorMessage(error.message) }, 400);
    }
    return json({ success: false, error: apiMessage("ma21942e5779f") }, 400);
  }

  try {
    await validateOssConnection(candidate);
  } catch (error) {
    return json({
      success: false,
      error: apiErrorMessage(toSafeOssConnectionError(error)),
    }, 422);
  }

  try {
    return json({
      success: true,
      ...await saveOssConfig(candidate),
    });
  } catch {
    return json({ success: false, error: apiMessage("m85b324ce74f8") }, 500);
  }
}
