// 进程内滑动窗口限流。
//
// ⚠️ 仅适用于单实例部署。多实例部署时各进程内存独立，限流会失效，
//    届时需替换为基于 Redis 的实现（如 @upstash/ratelimit 或自建）。

type Hit = number[];

const buckets = new Map<string, Hit>();

// 周期性清理过期 key，避免内存无限增长。
let lastSweep = 0;
function sweep(windowMs: number) {
  const now = Date.now();
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [key, hits] of buckets) {
    const fresh = hits.filter((t) => now - t < windowMs);
    if (fresh.length === 0) buckets.delete(key);
    else buckets.set(key, fresh);
  }
}

export interface RateLimitOptions {
  /** 窗口内允许的最大次数 */
  limit: number;
  /** 时间窗口（毫秒） */
  windowMs: number;
}

export interface RateLimitResult {
  ok: boolean;
  /** 剩余可用次数 */
  remaining: number;
  /** 距离窗口重置的毫秒数（被限流时有意义） */
  retryAfterMs: number;
}

/**
 * 检查并记录一次访问。
 * @param key 限流标识，通常为 `${用途}:${IP}` 或 `${用途}:${IP}:${用户名}`
 */
export function rateLimit(key: string, options: RateLimitOptions): RateLimitResult {
  const { limit, windowMs } = options;
  const now = Date.now();
  sweep(windowMs);

  const hits = (buckets.get(key) || []).filter((t) => now - t < windowMs);

  if (hits.length >= limit) {
    const oldest = hits[0];
    return {
      ok: false,
      remaining: 0,
      retryAfterMs: Math.max(0, windowMs - (now - oldest)),
    };
  }

  hits.push(now);
  buckets.set(key, hits);
  return { ok: true, remaining: limit - hits.length, retryAfterMs: 0 };
}

/** 从请求中提取客户端 IP（兼容反向代理） */
export function getClientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}
