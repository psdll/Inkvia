import { apiMessage } from "@/i18n/api-message";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAdminRequest } from "@/lib/admin-auth";
import { DEFAULT_PRICE_RULES } from "@/lib/billing/default-prices";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  if (!requireAdminRequest(req).ok)
    return NextResponse.json({ error: apiMessage("m9228f9aa4c65") }, { status: 401 });
  const rules = await prisma.billingPriceRule.findMany({
    where: {
      ...(req.nextUrl.searchParams.has("provider")
        ? { provider: req.nextUrl.searchParams.get("provider")! }
        : {}),
      ...(req.nextUrl.searchParams.has("model")
        ? { model: { in: req.nextUrl.searchParams.getAll("model") } }
        : {}),
    },
    orderBy: [{ provider: "asc" }, { model: "asc" }, { effectiveFrom: "desc" }],
  });
  return NextResponse.json(
    {
      rules: rules.map((r) => ({ ...r, unitPrice: String(r.unitPrice) })),
      defaults: DEFAULT_PRICE_RULES,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
export async function POST(req: NextRequest) {
  if (!requireAdminRequest(req).ok)
    return NextResponse.json({ error: apiMessage("m9228f9aa4c65") }, { status: 401 });
  return NextResponse.json(
    {
      error:
        apiMessage("ma69e41ebe2b1"),
    },
    { status: 409 },
  );
}
export const DELETE = POST;
