import { apiErrorMessage, apiMessage } from "@/i18n/api-message";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAdminRequest } from "@/lib/admin-auth";
import { resolveAdminUserScope } from "@/lib/admin-user-scope";
import { billingWhere, type BillingScope } from "@/lib/billing/monthly";
import { previewReconciliation } from "@/lib/billing/reconcile";
import { readBillingSettings, withBillingWrite } from "@/lib/billing/settings";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(req: NextRequest) {
  if (!requireAdminRequest(req).ok)
    return NextResponse.json({ error: apiMessage("m9228f9aa4c65") }, { status: 401 });
  try {
    const body = await req.json();
    const scope: BillingScope = {
      month: String(body.month),
      dateFrom: body.dateFrom ? String(body.dateFrom) : undefined,
      dateTo: body.dateTo ? String(body.dateTo) : undefined,
      provider: body.provider || undefined,
      model: body.model || undefined,
    };
    if (body.userId) {
      const id = Number(body.authUserId);
      const r = await resolveAdminUserScope(
        String(body.userId),
        Number.isSafeInteger(id) && id > 0 ? id : null,
        { explicitIdentity: true },
      );
      scope.identity = {
        authUserId: r.authUserId ?? null,
        userIds: r.linkedGuestUserIds?.length
          ? r.linkedGuestUserIds
          : [String(body.userId)],
      };
    }
    const cursor = Number(body.cursor) || 0;
    if (!Number.isSafeInteger(cursor) || cursor < 0)
      throw new Error("分页位置无效");
    const where = billingWhere(scope);
    const run = async (db: any) => {
      const preview = await previewReconciliation(
        db,
        where,
        await readBillingSettings(db),
        cursor,
      );
      if (body.action === "apply") {
        if (body.digest !== preview.digest)
          throw new Error("价格或流水发生变化，请重新预览后补算");
        for (const update of preview.updates) {
          await db.$queryRaw`SELECT "id" FROM "UsageLedger" WHERE "id" = ${update.id} FOR UPDATE`;
          const current = await db.usageLedger.findUnique({
            where: { id: update.id },
          });
          if (!current || +current.updatedAt !== +new Date(update.updatedAt))
            throw new Error("流水用量已变化，请重新预览后补算");
          if (
            current?.costStatus === "priced" &&
            (current.currency === "CNY" ||
              current.pricingSnapshot?.conversion?.amountCny != null)
          )
            throw new Error("流水已完成计价，请刷新后重新预览");
          await db.usageLedger.update({
            where: { id: update.id },
            data: update.data,
          });
        }
      } else if (body.action !== "preview") throw new Error("操作无效");
      return {
        digest: preview.digest,
        scanned: preview.scanned,
        nextCursor: preview.nextCursor,
        hasMore: preview.hasMore,
        amountCny: preview.amountCny,
        updated: body.action === "apply" ? preview.updates.length : 0,
        items: preview.updates.map(({ id, model, provider, providerModel, before, after }) => ({
          id,
          model,
          provider,
          providerModel,
          before,
          after,
        })),
      };
    };
    return NextResponse.json(
      body.action === "apply" ? await withBillingWrite(run) : await run(prisma),
    );
  } catch (e) {
    return NextResponse.json(
      { error: apiErrorMessage(e instanceof Error ? e.message : apiMessage("ma7d5c9810a15")) },
      { status: 400 },
    );
  }
}
