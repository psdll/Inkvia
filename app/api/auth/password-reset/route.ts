import { apiErrorMessage, apiMessage } from "@/i18n/api-message";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { generateToken } from "@/lib/server-auth";
import { resolveAuthCookieSecure } from "@/lib/cookie-security";
import { getClientIp, rateLimit } from "@/lib/rate-limit";
import {
  isPasswordResetAllowed,
  resetPasswordWithPermission,
} from "@/lib/password-reset-permission";
import { passwordResetSchema } from "@/lib/validation/auth";
import { CredentialError } from "@/lib/password-crypto";
import { logAdminAction } from "@/lib/admin-audit";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const username = String(request.nextUrl.searchParams.get("username") || "").trim();
  if (!username) {
    return NextResponse.json({ allowed: false });
  }

  const user = await prisma.user.findUnique({
    where: { username },
    select: { id: true },
  });
  if (!user) {
    return NextResponse.json({ allowed: false });
  }

  const allowed = await isPasswordResetAllowed(username);
  return NextResponse.json({ allowed });
}

export async function POST(request: NextRequest) {
  // 重置限流：同一 IP 1 小时内最多 10 次
  const ip = getClientIp(request);
  const limited = rateLimit(`password-reset:${ip}`, { limit: 10, windowMs: 60 * 60 * 1000 });
  if (!limited.ok) {
    return NextResponse.json(
      { success: false, error: apiMessage("m4f53a457ac1e") },
      { status: 429, headers: { "Retry-After": String(Math.ceil(limited.retryAfterMs / 1000)) } }
    );
  }

  const parsed = passwordResetSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: apiErrorMessage(parsed.error.errors[0]?.message || apiMessage("mfc77bc7bce4d")) },
      { status: 400 }
    );
  }
  const { username, newPassword } = parsed.data;
  const token = generateToken();
  let user;
  try {
    user = await resetPasswordWithPermission({ username, newPassword, sessionToken: token });
    await logAdminAction({ action: "password_reset_consumed", message: "自助重置密码成功，授权已关闭", level: "success", req: request,
      metadata: { userId: user.id, credentialVersion: user.credentialVersion, result: "success" } });
  } catch (error) {
    const invalid = error instanceof CredentialError && error.code === "PASSWORD_RESET_INVALID";
    return NextResponse.json({ success: false, error: apiErrorMessage(invalid ? apiMessage("m202b0d1a4997") : apiMessage("mba2b02535b7f")) }, { status: invalid ? 403 : 503, headers: { "Cache-Control": "no-store" } });
  }

  const response = NextResponse.json({
    success: true,
    user: {
      id: user.id,
      username,
    },
  });
  response.headers.set("Cache-Control", "no-store");
  response.cookies.set("auth_token", token, {
    httpOnly: true,
    secure: resolveAuthCookieSecure(request),
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 30,
    path: "/",
  });
  return response;
}
