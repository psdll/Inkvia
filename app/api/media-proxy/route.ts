import { apiErrorMessage } from "@/i18n/api-message";
import { NextRequest, NextResponse } from "next/server";
import { safeFetch } from "@/lib/ssrf-guard";
import { getClientIp, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MEDIA_PROXY_RATE_LIMIT = 60;
const MEDIA_PROXY_WINDOW_MS = 60 * 1000;
const MEDIA_PROXY_MAX_BYTES = 50 * 1024 * 1024;

function limitedBody(body: ReadableStream<Uint8Array>, maxBytes: number) {
  const reader = body.getReader();
  let total = 0;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) {
        controller.close();
        return;
      }
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        controller.error(new Error("media proxy response too large"));
        return;
      }
      controller.enqueue(value);
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}

export async function GET(req: NextRequest) {
  const limited = rateLimit(`media-proxy:${getClientIp(req)}`, {
    limit: MEDIA_PROXY_RATE_LIMIT,
    windowMs: MEDIA_PROXY_WINDOW_MS,
  });
  if (!limited.ok) {
    return NextResponse.json(
      { error: "rate limited" },
      {
        status: 429,
        headers: { "retry-after": String(Math.ceil(limited.retryAfterMs / 1000)) },
      },
    );
  }

  const url = new URL(req.url);
  const raw = String(url.searchParams.get("url") || "").trim();
  if (!raw) return NextResponse.json({ error: "missing url" }, { status: 400 });
  if (!/^https?:\/\//i.test(raw)) {
    return NextResponse.json({ error: "only http/https is allowed" }, { status: 400 });
  }

  let upstream: Response;
  try {
    upstream = await safeFetch(
      raw,
      {
        method: "GET",
        headers: {
          "user-agent": "Mozilla/5.0",
          accept: "image/*",
        },
        cache: "force-cache",
      },
    );
  } catch (e: any) {
    const msg = String(e?.message || "");
    if (msg === "forbidden host") {
      return NextResponse.json({ error: "forbidden host" }, { status: 403 });
    }
    if (msg === "only http/https is allowed" || msg === "invalid url") {
      return NextResponse.json({ error: apiErrorMessage(msg) }, { status: 400 });
    }
    return NextResponse.json({ error: "fetch failed" }, { status: 502 });
  }

  if (!upstream.ok || !upstream.body) {
    return NextResponse.json({ error: apiErrorMessage(`upstream ${upstream.status}`) }, { status: 502 });
  }

  const contentType = String(upstream.headers.get("content-type") || "").toLowerCase();
  if (!contentType.startsWith("image/") || contentType.split(";")[0].trim() === "image/svg+xml") {
    await upstream.body.cancel().catch(() => undefined);
    return NextResponse.json({ error: "unsupported media type" }, { status: 415 });
  }

  const contentLength = upstream.headers.get("content-length");
  const contentLengthBytes = contentLength && /^\d+$/.test(contentLength) ? Number(contentLength) : NaN;
  if (Number.isFinite(contentLengthBytes) && contentLengthBytes > MEDIA_PROXY_MAX_BYTES) {
    await upstream.body.cancel().catch(() => undefined);
    return NextResponse.json({ error: "media too large" }, { status: 413 });
  }

  return new NextResponse(limitedBody(upstream.body, MEDIA_PROXY_MAX_BYTES), {
    status: 200,
    headers: {
      "content-type": contentType,
      ...(Number.isFinite(contentLengthBytes) && !upstream.headers.has("content-encoding") ? { "content-length": String(contentLengthBytes) } : {}),
      "cache-control": "public, max-age=86400, stale-while-revalidate=604800",
      "x-content-type-options": "nosniff",
      "content-security-policy": "sandbox; default-src 'none'",
    },
  });
}
