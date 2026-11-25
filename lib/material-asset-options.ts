import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { DEFAULT_MATERIAL_ASSET_CATEGORIES, normalizeMaterialAssetCategory } from "@/lib/material-assets";

export const MATERIAL_ASSET_OPTION_KINDS = ["category", "creator", "model"] as const;
export type MaterialAssetOptionKind = (typeof MATERIAL_ASSET_OPTION_KINDS)[number];

type OptionFields = {
  category?: string | null;
  creatorName?: string | null;
  modelName?: string | null;
};

type OptionClient = Pick<Prisma.TransactionClient, "materialAssetOption">;
type OptionRow = { kind: string; value: string; isDeleted?: boolean };
type HistoricalAssetOptionRow = {
  category: string | null;
  creatorName: string | null;
  modelName: string | null;
};
type OptionReadClient = Pick<Prisma.TransactionClient, "materialAssetOption" | "materialAsset">;

export function isMaterialAssetOptionKind(value: unknown): value is MaterialAssetOptionKind {
  return MATERIAL_ASSET_OPTION_KINDS.includes(String(value) as MaterialAssetOptionKind);
}

export function normalizeMaterialAssetOptionValue(kind: MaterialAssetOptionKind, value: unknown) {
  if (kind === "category") return normalizeMaterialAssetCategory(value);
  const text = String(value || "").trim().replace(/\s+/g, " ");
  return text ? text.slice(0, 80) : null;
}

function optionEntries(fields: OptionFields) {
  return ([
    ["category", fields.category],
    ["creator", fields.creatorName],
    ["model", fields.modelName],
  ] as const).flatMap(([kind, raw]) => {
    const value = normalizeMaterialAssetOptionValue(kind, raw);
    return value ? [{ kind, value }] : [];
  });
}

export async function upsertMaterialAssetOptions(client: OptionClient, fields: OptionFields) {
  await Promise.all(
    optionEntries(fields).map(({ kind, value }) =>
      client.materialAssetOption.upsert({
        where: { kind_value: { kind, value } },
        create: { kind, value, isDeleted: false },
        update: { isDeleted: false },
      })
    )
  );
}

export async function markMaterialAssetOptionDeleted(
  client: OptionClient,
  kind: MaterialAssetOptionKind,
  value: string
) {
  await client.materialAssetOption.upsert({
    where: { kind_value: { kind, value } },
    create: { kind, value, isDeleted: true },
    update: { isDeleted: true },
  });
}

export function mergeMaterialAssetOptionValues(input: {
  optionRows: OptionRow[];
  assetRows: HistoricalAssetOptionRow[];
}) {
  const sets: Record<MaterialAssetOptionKind, Set<string>> = {
    category: new Set(DEFAULT_MATERIAL_ASSET_CATEGORIES),
    creator: new Set(),
    model: new Set(),
  };
  const deleted: Record<MaterialAssetOptionKind, Set<string>> = {
    category: new Set(),
    creator: new Set(),
    model: new Set(),
  };
  for (const row of input.optionRows) {
    if (!isMaterialAssetOptionKind(row.kind)) continue;
    const value = normalizeMaterialAssetOptionValue(row.kind, row.value);
    if (!value) continue;
    if (row.isDeleted) deleted[row.kind].add(value);
    else sets[row.kind].add(value);
  }
  for (const row of input.assetRows) {
    for (const { kind, value } of optionEntries(row)) sets[kind].add(value);
  }
  for (const kind of MATERIAL_ASSET_OPTION_KINDS) {
    for (const value of deleted[kind]) sets[kind].delete(value);
  }
  const sortValues = (values: Set<string>) => Array.from(values)
    .sort((a, b) => a.localeCompare(b, "zh-CN", { numeric: true, sensitivity: "base" }));
  return {
    category: sortValues(sets.category),
    creator: sortValues(sets.creator),
    model: sortValues(sets.model),
  };
}

export async function listMaterialAssetOptionValues(client: OptionReadClient = prisma) {
  const [optionRows, assetRows] = await Promise.all([
    client.materialAssetOption.findMany({
      orderBy: [{ kind: "asc" }, { value: "asc" }],
      select: { kind: true, value: true, isDeleted: true },
    }),
    client.materialAsset.findMany({
      where: { isDeleted: false },
      select: { category: true, creatorName: true, modelName: true },
    }),
  ]);
  return mergeMaterialAssetOptionValues({ optionRows, assetRows });
}
