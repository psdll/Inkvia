import crypto from "crypto";
import type { NextRequest } from "next/server";

const COOKIE_NAME = "ai_studio_admin";

function getEnv(name: string) {
  return (process.env[name] || "").trim();
}

export function adminCookieName() {
  return COOKIE_NAME;
}

export function adminEnabled() {
  return Boolean(getEnv("ADMIN_PASSWORD") && getEnv("ADMIN_SECRET"));
}

function sign(input: string) {
  const secret = getEnv("ADMIN_SECRET");
  return crypto.createHmac("sha256", secret).update(input).digest("base64url");
}

function encode(obj: unknown) {
  return Buffer.from(JSON.stringify(obj), "utf8").toString("base64url");
}

function decode<T>(b64: string): T | null {
  try {
    const json = Buffer.from(b64, "base64url").toString("utf8");
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}

type AdminTokenPayload = {
  u: string;
  iat: number;
  exp: number;
};

export function createAdminToken(username: string, ttlSeconds = 60 * 60 * 12) {
  if (!adminEnabled()) throw new Error("ADMIN_NOT_CONFIGURED");
  const expectedUser = getEnv("ADMIN_USERNAME") || "admin";
  if (username !== expectedUser || !Number.isSafeInteger(ttlSeconds) || ttlSeconds <= 0) throw new Error("ADMIN_TOKEN_INVALID");
  const now = Math.floor(Date.now() / 1000);
  const payload: AdminTokenPayload = { u: username, iat: now, exp: now + ttlSeconds };
  const body = encode(payload);
  const sig = sign(body);
  return `${body}.${sig}`;
}

export function verifyAdminToken(token: string | null | undefined) {
  if (!adminEnabled() || typeof token !== "string" || token.length > 4096) return null;
  const t = token.trim();
  if (!t) return null;
  const segments = t.split(".");
  if (segments.length !== 2) return null;
  const [body, sig] = segments;
  if (!body || !sig || !/^[A-Za-z0-9_-]+$/.test(body) || !/^[A-Za-z0-9_-]{43}$/.test(sig)) return null;
  const expected = sign(body);
  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return null;
    if (!crypto.timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }
  const payload = decode<AdminTokenPayload>(body);
  if (!payload) return null;
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.u !== "string" || payload.u !== (getEnv("ADMIN_USERNAME") || "admin")) return null;
  if (!Number.isSafeInteger(payload.iat) || !Number.isSafeInteger(payload.exp)
    || payload.iat < 0 || payload.iat > now || payload.exp <= now || payload.exp <= payload.iat) return null;
  return payload;
}

export function isAdminRequest(req: NextRequest) {
  const token = req.cookies.get(COOKIE_NAME)?.value || "";
  return Boolean(verifyAdminToken(token));
}

export function requireAdminRequest(req: NextRequest) {
  if (!adminEnabled()) return { ok: false as const, error: "管理员功能未配置" };
  const token = req.cookies.get(COOKIE_NAME)?.value || "";
  const payload = verifyAdminToken(token);
  if (!payload) return { ok: false as const, error: "未登录管理员" };
  return { ok: true as const, username: payload.u };
}

