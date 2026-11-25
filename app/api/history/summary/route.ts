import { apiMessage } from "@/i18n/api-message";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { pruneLogsIfNeeded } from "@/lib/log-retention";
import { getUserId } from "@/lib/server-auth";

const IN_PROGRESS = ["running", "queued", "pending", "submitted", "processing"];
const COMPLETED = ["success", "failed", "cancelled"];

export async function GET(req: NextRequest) {
  const authUserId = await getUserId(req);
  if (!authUserId) return NextResponse.json({ error: apiMessage("mc1986431234d") }, { status: 401 });
  await pruneLogsIfNeeded();

  const identityWhere = {
    OR: [
      { authUserId },
      { AND: [{ authUserId: null }, { userId: String(authUserId) }] },
    ],
  };

  const [inProgressCount, completedCount] = await Promise.all([
    prisma.generation.count({
      where: { AND: [identityWhere, { status: { in: IN_PROGRESS } }, { type: { not: "import" } }] } as any
    }),
    prisma.generation.count({
      where: { AND: [identityWhere, { status: { in: COMPLETED } }, { type: { not: "import" } }] } as any
    })
  ]);

  return NextResponse.json({ inProgressCount, completedCount });
}
