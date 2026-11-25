import { apiErrorMessage } from "@/i18n/api-message";
import { NextRequest, NextResponse } from "next/server";
import fs from "fs-extra";
import prisma from "@/lib/prisma";
import { requireAdminRequest } from "@/lib/admin-auth";
import { getCurrentUser } from "@/lib/server-auth";
import { isDesktopMode } from "@/lib/desktop-mode";
import { getCachedAdminUserSummaries } from "@/lib/admin-user-scope";
import {
  mapSummaryRow,
  isAdminSummaryReadModelReady,
  listAdminUserSummariesFromReadModel,
} from "@/lib/admin-user-summary-read-model";
import { resolvePublicPath } from "@/lib/public-path";
import { observeAdminLatency, recordAdminCacheResult } from "@/lib/admin-observability";

export const runtime = "nodejs";

function bad(message: string, status = 400) {
  return NextResponse.json({ error: apiErrorMessage(message) }, { status });
}

export async function GET(req: NextRequest) {
  const auth = requireAdminRequest(req);
  if (!auth.ok) return bad(auth.error, 401);

  if (isDesktopMode()) {
    const user = await getCurrentUser(req);
    const items = user ? [{
      adminKey: `auth:${user.id}`, authUserId: user.id, userId: String(user.id), username: user.username,
      generationCount: 0, lastCreatedAt: null,
    }] : [];
    return NextResponse.json({ items, hasMore: false }, { headers: { "Cache-Control": "no-store" } });
  }

  const startedAt = Date.now();
  const { searchParams } = new URL(req.url);
  const summaryOnly = searchParams.get("summaryOnly") === "1";

  const page = Math.max(1, Math.floor(Number(searchParams.get('page')) || 1));
  const q = String(searchParams.get('q') || '').trim().slice(0, 100);
  const selectedKey = String(searchParams.get('selected') || '').slice(0, 80);
  const limit = Math.max(1, Math.min(500, Math.floor(Number(searchParams.get('limit')) || 50)));
  if (await isAdminSummaryReadModelReady()) {
    const limit = Math.max(1, Math.min(500, Math.floor(Number(searchParams.get("limit")) || 500)));
    const pageCursor = String(searchParams.get("pageCursor") || "").trim() || null;
    let payload;
    try {
      payload = await listAdminUserSummariesFromReadModel({ limit, pageCursor, q, page });
    } catch {
      return bad("invalid summary page cursor");
    }
    const selected = selectedKey ? await prisma.adminUserSummary.findFirst({ where: { adminKey: selectedKey, deletedAt: null } }) : null;
    const ms = Date.now() - startedAt;
    observeAdminLatency("users_api", ms);
    observeAdminLatency("users_query", ms);
    if (ms > 200) console.warn(`[admin-perf] users-read-model ${ms}ms items=${payload.items.length}`);
    return NextResponse.json(
      { ...payload, selected: selected ? mapSummaryRow(selected) : null, serverTime: new Date().toISOString() },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  const presetRoot = resolvePublicPath("uploads", "presets");
  const idsFromPresets = !summaryOnly && (await fs.pathExists(presetRoot))
    ? await fs
        .readdir(presetRoot)
        .then((xs) => xs.filter((x) => /^[a-zA-Z0-9_-]{1,64}$/.test(x) && x !== "_builtin"))
        .catch(() => [])
    : [];

  const { items, stale } = await getCachedAdminUserSummaries(idsFromPresets);

  const ms = Date.now() - startedAt;
  observeAdminLatency("users_api", ms);
  observeAdminLatency("users_query", ms);
  recordAdminCacheResult("summary", stale ? "miss" : "hit");
  if (ms > 500) console.warn(`[admin-perf] users ${ms}ms stale=${stale} items=${items.length}`);

  const query = q.toLowerCase();
  const matches = query ? items.filter(item => [item.username, item.userId, item.adminKey].some(value => String(value || '').toLowerCase().includes(query))) : items;
  return NextResponse.json(
    { items: matches.slice((page - 1) * limit, page * limit), hasMore: page * limit < matches.length, selected: items.find(item => item.adminKey === selectedKey) || null, serverTime: new Date().toISOString() },
    { headers: { "Cache-Control": "no-store" } }
  );
}
