import { apiMessage } from "@/i18n/api-message";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const id = Number(params.id);
  if (!Number.isFinite(id)) return NextResponse.json({ success: false, error: apiMessage("m37b0cea26f1a") }, { status: 404 });

  const record = await prisma.template.findUnique({
    where: { id },
    include: { tags: { include: { tag: true } } }
  });

  if (!record) return NextResponse.json({ success: false, error: apiMessage("m37b0cea26f1a") }, { status: 404 });

  return NextResponse.json({
    success: true,
    data: {
      ...record,
      tags: record.tags.map((x) => x.tag.name)
    }
  });
}

