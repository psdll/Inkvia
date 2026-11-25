import { apiErrorMessage, apiMessage } from "@/i18n/api-message";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAdminRequest } from "@/lib/admin-auth";
import { resolveAdminUserScope } from "@/lib/admin-user-scope";
import {
  billingWhere,
  currentBillingMonth,
  csvCell,
  ledgerView,
  monthlyReport,
  type BillingScope,
} from "@/lib/billing/monthly";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  if (!requireAdminRequest(req).ok)
    return NextResponse.json({ error: apiMessage("m9228f9aa4c65") }, { status: 401 });
  try {
    const params = req.nextUrl.searchParams;
    const scope: BillingScope = {
      month: params.get("month") || currentBillingMonth(),
      dateFrom: params.get("dateFrom") || undefined,
      dateTo: params.get("dateTo") || undefined,
      provider: params.get("provider") || undefined,
      model: params.get("model") || undefined,
      providerModel: params.has("providerModel") ? params.get("providerModel")! : undefined,
    };
    const userId = params.get("userId");
    if (userId) {
      if (!/^[a-zA-Z0-9_-]{1,64}$/.test(userId))
        throw new Error("用户 ID 无效");
      const authId = Number(params.get("authUserId"));
      const resolved = await resolveAdminUserScope(
        userId,
        Number.isSafeInteger(authId) && authId > 0 ? authId : null,
        { explicitIdentity: true },
      );
      scope.identity = {
        authUserId: resolved.authUserId ?? null,
        userIds: resolved.linkedGuestUserIds?.length
          ? resolved.linkedGuestUserIds
          : [userId],
      };
    }
    const where = billingWhere(scope);
    if (params.get("export") === "details") {
      const upper = await prisma.usageLedger.aggregate({
        where,
        _max: { id: true },
      });
      const maxId = upper._max.id || 0;
      const encoder = new TextEncoder();
      let cursor = 0;
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              "\uFEFF" +
                [
                  "时间（北京时间）",
                  "用户",
                  "供应商",
                  "模型",
                  "实际调用模型",
                  "单位",
                  "用量",
                  "原币单价",
                  "原币金额",
                  "币种",
                  "汇率",
                  "人民币金额",
                  "状态",
                ]
                  .map(csvCell)
                  .join(",") +
                "\n",
            ),
          );
        },
        async pull(controller) {
          try {
            const rows = await prisma.usageLedger.findMany({
              where: { AND: [where, { id: { gt: cursor, lte: maxId } }] },
              orderBy: { id: "asc" },
              take: 1000,
            });
            if (!rows.length) {
              controller.close();
              return;
            }
            cursor = rows[rows.length - 1].id;
            controller.enqueue(
              encoder.encode(
                rows
                  .map((row) => {
                    const r = ledgerView(row);
                    return [
                      new Date(+new Date(r.occurredAt) + 8 * 3600000)
                        .toISOString()
                        .replace("T", " ")
                        .replace("Z", "+08:00"),
                      r.userId,
                      r.externalProvider,
                      r.model,
                      r.providerModel,
                      r.unitType,
                      r.unitCount,
                      r.unitPrice,
                      r.amount,
                      r.currency,
                      r.conversion?.rate ?? (r.currency === "CNY" ? 1 : ""),
                      r.amountCny,
                      r.costStatus,
                    ]
                      .map(csvCell)
                      .join(",");
                  })
                  .join("\n") + "\n",
              ),
            );
          } catch (error) {
            controller.error(error);
          }
        },
      });
      return new NextResponse(stream, {
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": `attachment; filename="billing-${scope.month}.csv"`,
          "Cache-Control": "no-store",
        },
      });
    }
    const page = Math.max(
      1,
      Math.min(1000000, Number(params.get("page")) || 1),
    );
    const pageSize = 50;
    const report = await monthlyReport(scope);
    const total = report.summary.ledgerCount;
    const rows =
      params.get("includeLedgers") === "0"
        ? []
        : await prisma.usageLedger.findMany({
            where,
            orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
            take: pageSize,
            skip: (page - 1) * pageSize,
          });
    return NextResponse.json(
      {
        ...report,
        ledgers: rows.map(ledgerView),
        pagination: {
          page,
          pageSize,
          total,
          totalPages: Math.max(1, Math.ceil(total / pageSize)),
          hasMore: page * pageSize < total,
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return NextResponse.json(
      { error: apiErrorMessage(e instanceof Error ? e.message : apiMessage("m6aa27f14bff1")) },
      { status: 400 },
    );
  }
}
