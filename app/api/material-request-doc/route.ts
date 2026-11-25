import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export const dynamic = "force-dynamic";

const URL_KEY = "material_request_doc_url";
const TEXT_KEY = "material_request_doc_text";
const DEFAULT_TEXT = "欢迎有需要的同事进行下载使用素材，需要做什么样的可以写文档说明";

export async function GET() {
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
