import { apiErrorMessage, apiMessage } from "@/i18n/api-message";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAdminRequest } from "@/lib/admin-auth";
export const dynamic = "force-dynamic";

const KEY = "tutorial_doc_url";

export async function GET(req: NextRequest) {
  const auth = requireAdminRequest(req);
  if (!auth.ok) return NextResponse.json({ success: false, error: apiErrorMessage(auth.error) }, { status: 401 });
  try {
    const row = await prisma.appSetting.findUnique({ where: { key: KEY } });
    return NextResponse.json({ success: true, url: String(row?.value || "") });
  } catch (e: any) {
    return NextResponse.json({ success: true, url: "" });
  }
}

export async function POST(req: NextRequest) {
  const auth = requireAdminRequest(req);
  if (!auth.ok) return NextResponse.json({ success: false, error: apiErrorMessage(auth.error) }, { status: 401 });

  const json = (await req.json().catch(() => null)) as any;
  const url = String(json?.url || "").trim();
  if (url.length > 2000) {
    return NextResponse.json({ success: false, error: apiMessage("m9e09c663d9b1") }, { status: 400 });
  }

  if (!url) {
    await prisma.appSetting.deleteMany({ where: { key: KEY } });
    return NextResponse.json({ success: true, url: "" });
  }

  await prisma.appSetting.upsert({
    where: { key: KEY },
    create: { key: KEY, value: url },
    update: { value: url },
  });
  return NextResponse.json({ success: true, url });
}
