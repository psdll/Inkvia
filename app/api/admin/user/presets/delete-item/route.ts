import { apiErrorMessage } from "@/i18n/api-message";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAdminRequest } from "@/lib/admin-auth";
import { resolveAdminUserScope } from "@/lib/admin-user-scope";
import { parseAdminWorksAdminKey } from "@/lib/admin-user-works";
import { parsePromptPublicId } from "@/lib/prompt-presets/contracts";
import { promptApiError } from "@/lib/prompt-presets/http";
import { deletePromptForUser } from "@/lib/prompt-presets/repository";

export const runtime = "nodejs";

function bad(message: string, status = 400) {
  return NextResponse.json({ error: apiErrorMessage(message) }, { status });
}

export async function POST(req: NextRequest | Request) {
  const auth = requireAdminRequest(req as NextRequest);
  if (!auth.ok) return bad(auth.error, 401);

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return bad("请求 JSON 格式无效");
  }
  if (
    Object.prototype.hasOwnProperty.call(body, "userId")
    || Object.prototype.hasOwnProperty.call(body, "authUserId")
    || Object.prototype.hasOwnProperty.call(body, "scope")
  ) {
    return bad("目标用户仅接受 adminKey");
  }

  const identity = parseAdminWorksAdminKey(
    typeof body.adminKey === "string" ? body.adminKey : null,
  );
  if (!identity || identity.authUserId == null) {
    return bad("仅支持已注册用户");
  }
  const { userId, authUserId } = identity;
  const presetId = String(body.presetId || "").trim();

  let source: "custom" | "builtin";
  try {
    source = parsePromptPublicId(presetId).source;
  } catch (error) {
    return bad(error instanceof Error ? error.message : "presetId 无效");
  }

  const expectedRevision = Number(body.expectedRevision);
  if (!Number.isInteger(expectedRevision) || expectedRevision < 1) {
    return bad("删除用户提示词需要有效的 expectedRevision");
  }

  const scopeInfo = await resolveAdminUserScope(userId, authUserId, {
    explicitIdentity: true,
  });
  if (scopeInfo.authUserId !== authUserId) {
    return bad("仅支持已注册用户");
  }

  try {
    await deletePromptForUser({
      authUserId,
      publicId: presetId,
      expectedRevision,
    });
  } catch (error) {
    return promptApiError(error);
  }

  await prisma.log
    .create({
      data: {
        userId: "system",
        category: "admin",
        action: "preset_delete_for_user",
        level: "warning",
        message: `管理员删除用户提示词：${userId}/${presetId}`,
        metadata: JSON.stringify({
          userId,
          authUserId,
          adminKey: identity.adminKey,
          linkedUserIds: scopeInfo.linkedUserIds,
          presetId,
          source,
          expectedRevision,
          by: auth.username,
        }),
      },
    })
    .catch(() => null);

  return NextResponse.json({ ok: true });
}
