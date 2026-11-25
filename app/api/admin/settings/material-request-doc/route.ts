import { apiErrorMessage, apiMessage } from "@/i18n/api-message";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAdminRequest } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

const URL_KEY = "material_request_doc_url";
const TEXT_KEY = "material_request_doc_text";
const DEFAULT_TEXT = "欢迎有需要的同事进行下载使用素材，需要做什么样的可以写文档说明";

function isHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export async function GET(req: NextRequest) {
  const auth = requireAdminRequest(req);
  if (!auth.ok) return NextResponse.json({ success: false, error: apiErrorMessage(auth.error) }, { status: 401 });
  try {
    const rows = await prisma.appSetting.findMany({ where: { key: { in: [URL_KEY, TEXT_KEY] } } });
    const map = Object.fromEntries(rows.map((row) => [row.key, row.value]));
    return NextResponse.json({
      success: true,
      url: String(map[URL_KEY] || ""),
      text: String(map[TEXT_KEY] || DEFAULT_TEXT),
    });
  } catch {
    return NextResponse.json({ success: true, url: "", text: DEFAULT_TEXT });
  }
}

export async function POST(req: NextRequest) {
  const auth = requireAdminRequest(req);
  if (!auth.ok) return NextResponse.json({ success: false, error: apiErrorMessage(auth.error) }, { status: 401 });

  const json = (await req.json().catch(() => null)) as any;
  const url = String(json?.url || "").trim();
  const text = String(json?.text || "").trim() || DEFAULT_TEXT;
  if (url.length > 2000) {
    return NextResponse.json({ success: false, error: apiMessage("m9e09c663d9b1") }, { status: 400 });
  }
  if (text.length > 180) {
    return NextResponse.json({ success: false, error: apiMessage("mc75900928775") }, { status: 400 });
  }

  if (!url) {
    await prisma.$transaction([
      prisma.appSetting.deleteMany({ where: { key: URL_KEY } }),
      prisma.appSetting.upsert({
        where: { key: TEXT_KEY },
        create: { key: TEXT_KEY, value: text },
        update: { value: text },
      }),
    ]);
    return NextResponse.json({ success: true, url: "", text });
  }

  if (!isHttpUrl(url)) {
    return NextResponse.json({ success: false, error: apiMessage("m019f9a5df758") }, { status: 400 });
  }

  await prisma.appSetting.upsert({
    where: { key: URL_KEY },
    create: { key: URL_KEY, value: url },
    update: { value: url },
  });
  await prisma.appSetting.upsert({
    where: { key: TEXT_KEY },
    create: { key: TEXT_KEY, value: text },
    update: { value: text },
  });
  return NextResponse.json({ success: true, url, text });
}
