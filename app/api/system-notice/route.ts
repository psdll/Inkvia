import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export const dynamic = "force-dynamic";

const KEY = "system_notice_v1";

type NoticeConfig = {
  enabled: boolean;
  text: string;
  href: string;
  startAt: string;
  endAt: string;
};

const DEFAULT_CONFIG: NoticeConfig = {
  enabled: false,
  text: "",
  href: "",
  startAt: "",
  endAt: "",
};

function normalizeIsoDate(raw: unknown) {
  const text = String(raw || "").trim();
  if (!text) return "";
  const d = new Date(text);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString();
}

function normalizeNoticeConfig(raw: any): NoticeConfig {
  const enabled = Boolean(raw?.enabled);
  const text = String(raw?.text || "").trim().slice(0, 180);
  const href = String(raw?.href || "").trim().slice(0, 2000);
  const startAt = normalizeIsoDate(raw?.startAt);
  const endAt = normalizeIsoDate(raw?.endAt);
  return { enabled, text, href, startAt, endAt };
}

export async function GET() {
  try {
    const row = await prisma.appSetting.findUnique({ where: { key: KEY } });
    const raw = String(row?.value || "").trim();
    if (!raw) return NextResponse.json({ success: true, config: { ...DEFAULT_CONFIG } });
    const parsed = normalizeNoticeConfig(JSON.parse(raw));
    return NextResponse.json({ success: true, config: parsed });
  } catch {
    return NextResponse.json({ success: true, config: { ...DEFAULT_CONFIG } });
  }
}
