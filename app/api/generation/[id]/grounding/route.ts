import { apiMessage } from "@/i18n/api-message";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getUserId } from "@/lib/server-auth";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const authUserId = await getUserId(req);
  if (!authUserId) return NextResponse.json({ error: apiMessage("m48144f96c150") }, { status: 401 });
  const id = Number(params.id);
  if (!Number.isSafeInteger(id) || id <= 0) return NextResponse.json({ error: apiMessage("m39a179be21a4") }, { status: 400 });
  const record = await prisma.generation.findFirst({ where: { id, authUserId }, select: { templateData: true } });
  if (!record) return NextResponse.json({ error: apiMessage("me4ba03868d92") }, { status: 404 });
  let template: any = {};
  try { template = JSON.parse(record.templateData || "{}"); } catch { /* Historical records may not contain JSON. */ }
  return NextResponse.json({ grounding: template.googleGrounding || null }, { headers: { "Cache-Control": "private, no-store" } });
}
