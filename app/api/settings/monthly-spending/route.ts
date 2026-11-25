import { apiMessage } from "@/i18n/api-message";
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/server-auth";
import { currentBillingMonth, monthlyReport } from "@/lib/billing/monthly";

export async function GET(request: NextRequest) {
  const headers = { "Cache-Control": "private, no-store" };
  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: apiMessage("m9503886094dc") }, { status: 401, headers });
  const report = await monthlyReport({
    month: currentBillingMonth(),
    identity: { authUserId: user.id, userIds: [String(user.id)] },
  });
  return NextResponse.json({
    month: report.range.month,
    totalAmount: report.summary.totalAmount,
    pendingCount: report.summary.pendingCount,
    daily: report.daily.map(({ day, amount }) => ({ day, amount })),
  }, { headers });
}
