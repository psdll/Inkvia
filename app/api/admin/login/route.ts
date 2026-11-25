import { apiErrorMessage, apiMessage } from "@/i18n/api-message";
import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { adminCookieName, adminEnabled, createAdminToken } from "@/lib/admin-auth";
import { logAdminAction } from "@/lib/admin-audit";
import { getClientIp, rateLimit } from "@/lib/rate-limit";
import { adminLoginSchema } from "@/lib/validation/auth";
export const runtime = "nodejs";

const ADMIN_DEVICE_COOKIE_NAME = "ai_studio_admin_device";

function bad(message: string, status = 400) {
  return NextResponse.json({ error: apiErrorMessage(message) }, { status });
}

function parseBool(v: string | undefined, fallback: boolean) {
  const s = String(v || "").trim().toLowerCase();
  if (!s) return fallback;
  if (["1", "true", "yes", "on"].includes(s)) return true;
  if (["0", "false", "no", "off"].includes(s)) return false;
  return fallback;
}

function resolveAdminCookieSecure(req: Request) {
  const proto = String(req.headers.get("x-forwarded-proto") || "")
    .toLowerCase()
    .split(",")[0]
    .trim();
  const byProtoHeader = proto === "https";
  const byUrl = (() => {
    try {
      return new URL(req.url).protocol === "https:";
    } catch {
      return false;
    }
  })();
  const auto = byProtoHeader || byUrl;
  return parseBool(process.env.ADMIN_COOKIE_SECURE, auto);
}

function browserName(userAgent: string) {
  if (/Edg\//i.test(userAgent)) return "Edge";
  if (/OPR\//i.test(userAgent)) return "Opera";
  if (/(?:CriOS|Chrome)\//i.test(userAgent)) return "Chrome";
  if (/(?:FxiOS|Firefox)\//i.test(userAgent)) return "Firefox";
  if (/Version\/[^ ]+.*Safari\//i.test(userAgent)) return "Safari";
  return "未知浏览器";
}

function operatingSystem(req: Request, userAgent: string) {
  const platform = String(req.headers.get("sec-ch-ua-platform") || "").replace(/^"|"$/g, "").trim();
  if (platform && platform !== "Unknown") return platform;
  if (/Windows/i.test(userAgent)) return "Windows";
  if (/Android/i.test(userAgent)) return "Android";
  if (/(?:iPhone|iPad|iPod)/i.test(userAgent)) return "iOS";
  if (/(?:Macintosh|Mac OS X)/i.test(userAgent)) return "macOS";
  if (/Linux/i.test(userAgent)) return "Linux";
  return "未知系统";
}

function deviceType(req: Request, userAgent: string) {
  if (/(?:iPad|Tablet)/i.test(userAgent) || (/Android/i.test(userAgent) && !/Mobile/i.test(userAgent))) return "平板";
  if (req.headers.get("sec-ch-ua-mobile") === "?1" || /(?:Mobile|iPhone|iPod)/i.test(userAgent)) return "手机";
  return "电脑";
}

function resolveDeviceId(req: NextRequest) {
  const current = String(req.cookies.get(ADMIN_DEVICE_COOKIE_NAME)?.value || "").trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(current)
    ? current
    : randomUUID();
}

export async function POST(req: NextRequest) {
  if (!adminEnabled()) return bad("管理员功能未配置", 500);

  // 管理员登录限流：同一 IP 5 分钟内最多 8 次尝试
  const ip = getClientIp(req);
  const limited = rateLimit(`admin-login:${ip}`, { limit: 8, windowMs: 5 * 60 * 1000 });
  if (!limited.ok) {
    return NextResponse.json(
      { error: apiMessage("m3245d6d9e5a0") },
      { status: 429, headers: { "Retry-After": String(Math.ceil(limited.retryAfterMs / 1000)) } }
    );
  }

  const parsed = adminLoginSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return bad(parsed.error.errors[0]?.message || "参数不合法");
  }
  const username = String(parsed.data.username || "admin").trim();
  const password = parsed.data.password.trim();

  const expectedUser = (process.env.ADMIN_USERNAME || "").trim() || "admin";
  const expectedPass = (process.env.ADMIN_PASSWORD || "").trim();

  if (!password) return bad("请输入密码");
  if (username !== expectedUser || password !== expectedPass) return bad("账号或密码错误", 401);

  const token = createAdminToken(username);
  const deviceId = resolveDeviceId(req);
  const userAgent = String(req.headers.get("user-agent") || "").trim();
  const browser = browserName(userAgent);
  const os = operatingSystem(req, userAgent);
  const type = deviceType(req, userAgent);
  const deviceLabel = `${os} · ${browser} · ${type}`;
  await logAdminAction({
    admin: username,
    action: "admin_login",
    level: "success",
    message: `管理员账号 ${username} 登录 · ${deviceLabel}`,
    metadata: {
      browser,
      deviceId,
      deviceLabel,
      deviceType: type,
      operatingSystem: os,
    },
    req,
  }).catch(() => undefined);
  const res = NextResponse.json({ ok: true });
  const cookieSecure = resolveAdminCookieSecure(req);
  res.cookies.set(adminCookieName(), token, {
    httpOnly: true,
    sameSite: "lax",
    secure: cookieSecure,
    path: "/",
    maxAge: 60 * 60 * 12
  });
  res.cookies.set(ADMIN_DEVICE_COOKIE_NAME, deviceId, {
    httpOnly: true,
    sameSite: "lax",
    secure: cookieSecure,
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  return res;
}
