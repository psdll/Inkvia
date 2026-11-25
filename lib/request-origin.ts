export function hasSameRequestOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin || request.headers.get("sec-fetch-site") === "cross-site") return false;
  try {
    const destination = new URL(request.url);
    // Next can reconstruct request.url with its bind hostname. Host is the actual
    // destination authority; x-forwarded-host is deliberately not trusted here.
    const host = request.headers.get("host") || destination.host;
    const forwardedProtocol = request.headers.get("x-forwarded-proto");
    const protocol = forwardedProtocol === "http" || forwardedProtocol === "https" ? `${forwardedProtocol}:` : destination.protocol;
    return new URL(origin).origin === new URL(`${protocol}//${host}`).origin;
  } catch { return false; }
}
