import { apiErrorMessage, apiMessage } from "@/i18n/api-message";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAdminRequest } from "@/lib/admin-auth";
export const dynamic = "force-dynamic";

const KEY_RETENTION_DAYS = "data_retention_days";
const KEY_LAST_PRUNED_AT = "data_retention_last_pruned_at";

function fallbackDays() {
  const raw = (process.env.DATA_RETENTION_DAYS || process.env.LOG_RETENTION_DAYS || "").trim();
  const n = Number(raw);
  if (Number.isFinite(n) && n > 0) return Math.floor(n);
  return 15;
}

export async function GET(req: NextRequest) {
  const auth = requireAdminRequest(req);
  if (!auth.ok) return NextResponse.json({ success: false, error: apiErrorMessage(auth.error) }, { status: 401 });
  try {
    const rows = await prisma.appSetting.findMany({
      where: { key: { in: [KEY_RETENTION_DAYS, KEY_LAST_PRUNED_AT] } },
    });
    const byKey = new Map<string, { value: string; updatedAt: string | null }>();
    for (const r of rows || [])
      byKey.set(String(r.key || ""), {
        value: String(r.value || ""),
        updatedAt: r.updatedAt ? r.updatedAt.toISOString() : null,
      });
    const customDays = Number(byKey.get(KEY_RETENTION_DAYS)?.value || "");
    const days = Number.isFinite(customDays) && customDays > 0 ? Math.floor(customDays) : fallbackDays();
    const source = Number.isFinite(customDays) && customDays > 0 ? "custom" : "fallback";
    const updatedAt = byKey.get(KEY_RETENTION_DAYS)?.updatedAt || null;
    const lastPrunedAt = byKey.get(KEY_LAST_PRUNED_AT)?.value || null;
    return NextResponse.json({ success: true, days, source, updatedAt, lastPrunedAt });
  } catch (e: any) {
    return NextResponse.json({ success: true, days: fallbackDays(), source: "fallback", updatedAt: null, lastPrunedAt: null });
  }
}

export async function POST(req: NextRequest) {
  const auth = requireAdminRequest(req);
  if (!auth.ok) return NextResponse.json({ success: false, error: apiErrorMessage(auth.error) }, { status: 401 });
  const json = (await req.json().catch(() => null)) as any;
  const daysRaw = Number(json?.days);
  if (!Number.isFinite(daysRaw)) {
    return NextResponse.json({ success: false, error: apiMessage("mc2004d061700") }, { status: 400 });
  }
  const days = Math.floor(daysRaw);
  if (days < 1 || days > 365) {
    return NextResponse.json({ success: false, error: apiMessage("md7ce243463f7") }, { status: 400 });
  }
  await prisma.appSetting.upsert({
    where: { key: KEY_RETENTION_DAYS },
    create: { key: KEY_RETENTION_DAYS, value: String(days) },
    update: { value: String(days) },
  });
  return NextResponse.json({ success: true, days, source: "custom" });
}
