import { apiErrorMessage } from "@/i18n/api-message";
import { NextRequest, NextResponse } from "next/server";
import { requireAdminRequest } from "@/lib/admin-auth";
import { getCachedAdminUserSummaries } from "@/lib/admin-user-scope";
import {
  getAdminUserSummaryChanges,
  isAdminSummaryReadModelReady,
} from "@/lib/admin-user-summary-read-model";

export const runtime = "nodejs";

function bad(message: string, status = 400) {
  return NextResponse.json({ error: apiErrorMessage(message) }, { status });
}

function toTime(value: string | null | undefined) {
  if (!value) return 0;
  const t = new Date(value).getTime();
  return Number.isNaN(t) ? 0 : t;
}

export async function GET(req: NextRequest) {
  const auth = requireAdminRequest(req);
  if (!auth.ok) return bad(auth.error, 401);

  const startedAt = Date.now();
  const { searchParams } = new URL(req.url);
  const sinceRaw = String(searchParams.get("since") || "").trim();
  const sinceMs = toTime(sinceRaw);

  if (await isAdminSummaryReadModelReady()) {
    const cursor = String(searchParams.get("cursor") || "").trim() || null;
    const limit = Math.max(1, Math.min(500, Math.floor(Number(searchParams.get("limit")) || 100)));
    try {
      const payload = await getAdminUserSummaryChanges({ cursor, since: sinceRaw || null, limit });
      const ms = Date.now() - startedAt;
      if (ms > 200) console.warn(`[admin-perf] summary-changes-read-model ${ms}ms items=${payload.items.length}`);
      return NextResponse.json(
        { ...payload, serverTime: new Date().toISOString() },
        { headers: { "Cache-Control": "no-store" } },
      );
    } catch {
      return bad("invalid summary cursor");
    }
  }

  const { items, stale } = await getCachedAdminUserSummaries([]);
  // 用 summaryUpdatedAt（最大 updatedAt）判断变化，能捕获 success/failed 状态变更；无值回退 lastCreatedAt。
  const changed = sinceMs > 0 ? items.filter((item) => toTime(item.summaryUpdatedAt ?? item.lastCreatedAt) > sinceMs) : items;

  const ms = Date.now() - startedAt;
  if (ms > 500) console.warn(`[admin-perf] summary-changes ${ms}ms stale=${stale} items=${items.length}`);

  return NextResponse.json(
    { items: changed, serverTime: new Date().toISOString() },
    { headers: { "Cache-Control": "no-store" } }
  );
}
