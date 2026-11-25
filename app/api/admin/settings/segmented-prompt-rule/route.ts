import { apiErrorMessage, apiMessage } from "@/i18n/api-message";
import { NextRequest, NextResponse } from "next/server";
import { requireAdminRequest } from "@/lib/admin-auth";
import {
  SegmentedPromptRuleError,
  getSegmentedPromptRule,
  resetSegmentedPromptRule,
  saveSegmentedPromptRule,
} from "@/lib/image-batch/segmented-prompt-rule";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function requireAdmin(req: NextRequest) {
  const auth = requireAdminRequest(req);
  if (auth.ok) return null;
  return json({ success: false, error: apiErrorMessage(auth.error) }, 401);
}

function ruleError(error: unknown) {
  if (error instanceof SegmentedPromptRuleError) {
    return json(
      { success: false, code: error.code, error: apiErrorMessage(error.message) },
      error.status,
    );
  }
  return json(
    { success: false, code: "RULE_SAVE_FAILED", error: apiMessage("mc2af18312f53") },
    500,
  );
}

export async function GET(req: NextRequest) {
  const unauthorized = requireAdmin(req);
  if (unauthorized) return unauthorized;
  try {
    const config = await getSegmentedPromptRule();
    return json({ success: true, config });
  } catch (error) {
    return ruleError(error);
  }
}

export async function POST(req: NextRequest) {
  const unauthorized = requireAdmin(req);
  if (unauthorized) return unauthorized;
  try {
    const body = await req.json().catch(() => null);
    const config = await saveSegmentedPromptRule({
      ruleText: body?.ruleText,
      expectedRevision: body?.expectedRevision,
    });
    return json({ success: true, config });
  } catch (error) {
    return ruleError(error);
  }
}

export async function DELETE(req: NextRequest) {
  const unauthorized = requireAdmin(req);
  if (unauthorized) return unauthorized;
  try {
    const body = await req.json().catch(() => null);
    const config = await resetSegmentedPromptRule({
      expectedRevision: body?.expectedRevision,
    });
    return json({ success: true, config });
  } catch (error) {
    return ruleError(error);
  }
}
