// 统一的 cookie secure 标记决策。
//
// 公网 HTTPS 部署时 cookie 必须带 secure；内网 HTTP 调试时必须不带，否则浏览器丢弃 cookie。
// 决策优先级：显式环境变量 > 请求协议自动判断。

function parseBool(v: string | undefined, fallback: boolean): boolean {
  const s = String(v || "").trim().toLowerCase();
  if (!s) return fallback;
  if (["1", "true", "yes", "on"].includes(s)) return true;
  if (["0", "false", "no", "off"].includes(s)) return false;
  return fallback;
}

/** 根据请求协议判断是否 HTTPS（兼容反向代理的 x-forwarded-proto） */
function isHttpsRequest(req: Request): boolean {
  const proto = String(req.headers.get("x-forwarded-proto") || "")
    .toLowerCase()
    .split(",")[0]
    .trim();
  if (proto === "https") return true;
  try {
    return new URL(req.url).protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * 普通用户登录态 cookie（auth_token）的 secure 标记。
 * 由 AUTH_COOKIE_SECURE 环境变量覆盖，留空时按请求协议自动判断。
 */
export function resolveAuthCookieSecure(req: Request): boolean {
  return parseBool(process.env.AUTH_COOKIE_SECURE, isHttpsRequest(req));
}

/**
 * 管理员会话 cookie 的 secure 标记。
 * 由 ADMIN_COOKIE_SECURE 环境变量覆盖，留空时按请求协议自动判断。
 */
export function resolveAdminCookieSecure(req: Request): boolean {
  return parseBool(process.env.ADMIN_COOKIE_SECURE, isHttpsRequest(req));
}
