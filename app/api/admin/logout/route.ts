import { NextResponse } from "next/server";
import { adminCookieName } from "@/lib/admin-auth";

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

export async function POST(req: Request) {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(adminCookieName(), "", {
    httpOnly: true,
    sameSite: "lax",
    secure: resolveAdminCookieSecure(req),
    path: "/",
    maxAge: 0
  });
  return res;
}
