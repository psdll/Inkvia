import { apiMessage } from "@/i18n/api-message";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getCurrentUser } from "@/lib/server-auth";
import { isMaterialUploadAllowed } from "@/lib/material-upload-permission";
import { isMaterialCreatorInspirationEnabled } from "@/lib/material-creator-permissions";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const headers = { "Cache-Control": "private, no-store" };
  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: apiMessage("mc1f658373079") }, { status: 401, headers });

  const [canUploadMaterial, hasMaterialInspirations] = await Promise.all([
    isMaterialUploadAllowed(user.username),
    isMaterialCreatorInspirationEnabled(user.username).then(async (enabled) => enabled && Boolean(
      await prisma.materialAsset.findFirst({
        where: { isDeleted: false, creatorName: user.username },
        select: { id: true },
      })
    )),
  ]);
  return NextResponse.json({ canUploadMaterial, hasMaterialInspirations }, { headers });
}
