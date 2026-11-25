import { apiErrorMessage, apiMessage } from "@/i18n/api-message";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { DEFAULT_MATERIAL_ASSET_CATEGORIES, normalizeMaterialAssetCategory } from "@/lib/material-assets";
import { normalizeMaterialAssetOptionValue } from "@/lib/material-asset-options";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const naturalCollator = new Intl.Collator("zh-CN", { numeric: true, sensitivity: "base" });

export async function GET(request: NextRequest) {
  try {
    const rows = await prisma.materialAsset.groupBy({
      by: ["category", "modelName"],
      where: { isDeleted: false },
    });
    const modelsByCategory = new Map<string, Set<string>>();
    for (const row of rows) {
      const category = normalizeMaterialAssetCategory(row.category);
      if (!category) continue;

      const models = modelsByCategory.get(category) || new Set<string>();
      const model = normalizeMaterialAssetOptionValue("model", row.modelName);
      if (model) models.add(model);
      modelsByCategory.set(category, models);
    }

    const present = Array.from(modelsByCategory.keys());
    const categories = [
      ...DEFAULT_MATERIAL_ASSET_CATEGORIES.filter((category) => present.includes(category)),
      ...present
        .filter((category) => !DEFAULT_MATERIAL_ASSET_CATEGORIES.includes(category))
        .sort(naturalCollator.compare),
    ];
    const modelGroups = categories.flatMap((category) => {
      const models = Array.from(modelsByCategory.get(category) || []).sort(naturalCollator.compare);
      return models.length ? [{ category, models }] : [];
    });

    return NextResponse.json({ success: true, categories, modelGroups, hasUngrouped: rows.some((row) => !normalizeMaterialAssetCategory(row.category)) });
  } catch (error: any) {
    return NextResponse.json({ error: apiErrorMessage(error?.message || apiMessage("m0b1d8561698c")) }, { status: 500 });
  }
}
