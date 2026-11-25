import { apiMessage } from "@/i18n/api-message";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getUserId } from "@/lib/server-auth";

export const runtime = "nodejs";

function positiveInt(value: string | null, fallback: number, max: number) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? Math.min(parsed, max) : fallback;
}

export async function GET(req: NextRequest) {
  const authUserId = await getUserId(req);
  if (!authUserId) return NextResponse.json({ error: apiMessage("mc1f658373079") }, { status: 401 });
  const after = positiveInt(req.nextUrl.searchParams.get("after"), 0, Number.MAX_SAFE_INTEGER);
  const take = positiveInt(req.nextUrl.searchParams.get("take"), 500, 500) || 500;
  const events = await prisma.adminEvent.findMany({
    where: {
      id: { gt: after },
      eventType: "generation_deleted",
      entityType: "generation",
      OR: [
        { authUserId },
        { authUserId: null, userId: String(authUserId) },
      ],
    },
    orderBy: { id: "asc" },
    take: take + 1,
    select: { id: true, entityId: true },
  });
  const page = events.slice(0, take);
  const ids = page
    .map((event) => Number(event.entityId))
    .filter((id) => Number.isSafeInteger(id) && id > 0);
  return NextResponse.json({
    ids,
    cursor: page.at(-1)?.id || after,
    hasMore: events.length > take,
  });
}
