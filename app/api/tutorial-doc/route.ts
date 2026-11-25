import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export const dynamic = "force-dynamic";

const KEY = "tutorial_doc_url";

export async function GET() {
  try {
    const row = await prisma.appSetting.findUnique({ where: { key: KEY } });
    const url = String(row?.value || "");
    return NextResponse.json({ success: true, url });
  } catch (e: any) {
    return NextResponse.json({ success: true, url: "" });
  }
}
