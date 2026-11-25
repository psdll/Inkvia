import { apiErrorMessage, apiMessage } from "@/i18n/api-message";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAdminRequest } from "@/lib/admin-auth";
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

function parseNoticeValue(raw: unknown): NoticeConfig {
  const value = String(raw || "").trim();
  if (!value) return { ...DEFAULT_CONFIG };
  try {
    return normalizeNoticeConfig(JSON.parse(value));
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export async function GET(req: NextRequest) {
  const auth = requireAdminRequest(req);
  if (!auth.ok) return NextResponse.json({ success: false, error: apiErrorMessage(auth.error) }, { status: 401 });
  try {
    const row = await prisma.appSetting.findUnique({ where: { key: KEY } });
    const config = parseNoticeValue(row?.value);
    return NextResponse.json({ success: true, config });
  } catch {
    return NextResponse.json({ success: true, config: { ...DEFAULT_CONFIG } });
  }
}

export async function POST(req: NextRequest) {
  const auth = requireAdminRequest(req);
  if (!auth.ok) return NextResponse.json({ success: false, error: apiErrorMessage(auth.error) }, { status: 401 });

  const json = (await req.json().catch(() => null)) as any;
  const config = normalizeNoticeConfig(json?.config || json);
  if (config.enabled && !config.text) {
    return NextResponse.json({ success: false, error: apiMessage("m06f0994e113d") }, { status: 400 });
  }
  if (config.startAt && config.endAt && new Date(config.startAt).getTime() > new Date(config.endAt).getTime()) {
    return NextResponse.json({ success: false, error: apiMessage("m25f4c134a66b") }, { status: 400 });
  }

  const value = JSON.stringify(config);
  await prisma.appSetting.upsert({
    where: { key: KEY },
    create: { key: KEY, value },
    update: { value },
  });
  return NextResponse.json({ success: true, config });
}
