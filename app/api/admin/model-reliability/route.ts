import { apiErrorMessage, apiMessage } from "@/i18n/api-message";
import { NextRequest, NextResponse } from "next/server";

import { requireAdminRequest } from "@/lib/admin-auth";
import {
  buildAdminModelReliability,
  getAdminModelReliabilityWindowStart,
} from "@/lib/admin-model-reliability";
import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { adminModelCallSource } from "@/lib/admin/model-call-source";
import type { AdminModelReliabilitySourceRow } from "@/lib/admin-model-reliability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = requireAdminRequest(request);
  if (!auth.ok) {
    return NextResponse.json(
      { error: apiErrorMessage(auth.error) },
      {
        status: auth.error === "未登录管理员" ? 401 : 503,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }

  const now = new Date();
  try {
    const rows = await prisma.$queryRaw<AdminModelReliabilitySourceRow[]>(Prisma.sql`
      SELECT "externalProvider", model, type, status, "errorMsg", "createdAt"
      FROM ${adminModelCallSource()}
      WHERE "createdAt" >= ${getAdminModelReliabilityWindowStart(now)} AND "createdAt" <= ${now}
        AND status IN ('success', 'failed')`);

    return NextResponse.json(buildAdminModelReliability(rows, now), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json(
      { error: apiMessage("m9ea9c45cc968") },
      {
        status: 500,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}
