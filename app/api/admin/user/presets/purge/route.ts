import { apiErrorMessage } from "@/i18n/api-message";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAdminRequest } from "@/lib/admin-auth";
import { resolveAdminUserScope } from "@/lib/admin-user-scope";
import { parseAdminWorksAdminKey } from "@/lib/admin-user-works";
import { resolvePublicDir } from "@/lib/public-path";
import { scanLegacyPromptPresets } from "@/lib/prompt-presets/migration";

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

  const scopeInfo = await resolveAdminUserScope(userId, authUserId, {
    explicitIdentity: true,
  });
  if (scopeInfo.authUserId !== authUserId) {
    return bad("仅支持已注册用户");
  }

  const legacyScan = await scanLegacyPromptPresets({
    publicDir: resolvePublicDir(),
    presetUserIds: scopeInfo.presetUserIds,
  });
  const subjectKey = `user:${authUserId}:user-json`;
  const completedAt = new Date();

  const removed = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`
      SELECT pg_advisory_xact_lock(hashtext(${subjectKey}))::text
    `;

    const builtinDeletions = await tx.userBuiltinPromptDeletion.deleteMany({
      where: { authUserId },
    });
    await tx.promptPresetMigrationState.deleteMany({
      where: { authUserId },
    });
    const customPrompts = await tx.promptPreset.deleteMany({
      where: { authUserId },
    });

    const marker = {
      subjectKey,
      authUserId,
      source: "user-json",
      version: legacyScan.version,
      digest: legacyScan.digest,
      rowCount: 0,
      completedAt,
    };
    await tx.promptPresetMigrationState.upsert({
      where: { subjectKey },
      create: marker,
      update: marker,
    });

    return {
      customPrompts: customPrompts.count,
      builtinDeletions: builtinDeletions.count,
    };
  });

  await prisma.log
    .create({
      data: {
        userId: "system",
        category: "admin",
        action: "preset_purge",
        level: "warning",
        message: `管理员清空用户提示词：${userId}`,
        metadata: JSON.stringify({
          userId,
          authUserId,
          adminKey: identity.adminKey,
          linkedUserIds: scopeInfo.linkedUserIds,
          removed,
          preservedLegacyDigest: legacyScan.digest,
          by: auth.username,
        }),
      },
    })
    .catch(() => null);

  return NextResponse.json({ ok: true, removed });
}
