type SessionResponseInput = {
  url: string;
  status: number;
  origin: string;
};

const EXCLUDED_API_PATH_PREFIXES = [
  "/api/auth/",
  "/api/admin/",
  "/api/internal/",
];

export function shouldHandleUserSessionUnauthorized({
  url,
  status,
  origin,
}: SessionResponseInput): boolean {
  if (status !== 401) return false;

  try {
    const requestUrl = new URL(url, origin);
    if (requestUrl.origin !== origin || !requestUrl.pathname.startsWith("/api/")) return false;
    return !EXCLUDED_API_PATH_PREFIXES.some((prefix) => requestUrl.pathname.startsWith(prefix));
  } catch {
    return false;
  }
}
