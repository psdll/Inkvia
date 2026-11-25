import { apiMessage } from "@/i18n/api-message";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { getCurrentUser } from "@/lib/server-auth";

const COLORS = ["#4f7cff", "#14b8a6", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#f97316", "#22c55e"];

type UsageAggregate = {
  model: string | null;
  type: string;
  status: string;
  total: bigint;
  last30: bigint;
  last7: bigint;
  lastUsedAt: Date;
};

type TrendAggregate = { model: string | null; day: string; count: bigint };

function startOfLocalDay(date: Date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function dayKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function buildDays(days: number) {
  const today = startOfLocalDay(new Date());
  const start = addDays(today, -(days - 1));
  return Array.from({ length: days }, (_, index) => {
    const date = addDays(start, index);
    return { key: dayKey(date), label: `${date.getMonth() + 1}/${date.getDate()}` };
  });
}

function normalizeModel(value: string | null) {
  const text = String(value || "").trim();
  return text || "未标注模型";
}

function typeLabel(type: string) {
  const value = String(type || "").trim();
  const map: Record<string, string> = {
    image_edit: "图片",
    image_gen: "图片",
    text_to_image: "图片",
    video_gen: "视频",
    video_generate: "视频",
    face_swap: "人脸",
    inpainting: "局部重绘",
    ocr: "OCR",
  };
  return map[value] || value || "其他";
}

function inc(map: Record<string, number>, key: string, amount = 1) {
  map[key] = (map[key] || 0) + amount;
}

function buildTrend(rows: TrendAggregate[], days: number, topModels: string[]) {
  const dayList = buildDays(days);
  const byDay = new Map<string, Map<string, number>>();
  const startKey = dayList[0]?.key || "";

  for (const row of rows) {
    const key = row.day;
    if (key < startKey) continue;
    const model = normalizeModel(row.model);
    const bucketModel = topModels.includes(model) ? model : "其他模型";
    const perDay = byDay.get(key) || new Map<string, number>();
    perDay.set(bucketModel, (perDay.get(bucketModel) || 0) + Number(row.count));
    byDay.set(key, perDay);
  }

  return dayList.map((day) => {
    const perDay = byDay.get(day.key) || new Map<string, number>();
    const models: Record<string, number> = {};
    let total = 0;
    for (const model of [...topModels, "其他模型"]) {
      const count = perDay.get(model) || 0;
      if (count > 0 || model !== "其他模型") models[model] = count;
      total += count;
    }
    return { day: day.key, label: day.label, total, models };
  });
}

async function readModelUsage(userId: number) {
  const today = startOfLocalDay(new Date());
  const start7 = addDays(today, -6);
  const start30 = addDays(today, -29);
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  // Prisma timestamps are UTC without a timezone. Preserve the server-local day
  // boundaries used by the existing statistics, including legacy user ownership.
  const since7 = Prisma.sql`(${start7}::timestamptz AT TIME ZONE 'UTC')`;
  const since30 = Prisma.sql`(${start30}::timestamptz AT TIME ZONE 'UTC')`;
  const scope = Prisma.sql`("authUserId" = ${userId} OR ("authUserId" IS NULL AND "userId" = ${String(userId)})) AND "type" <> 'import'`;
  const [rows, trends] = await Promise.all([
    prisma.$queryRaw<UsageAggregate[]>(Prisma.sql`
      SELECT "model", "type", "status", COUNT(*) AS "total",
        COUNT(*) FILTER (WHERE "createdAt" >= ${since30}) AS "last30",
        COUNT(*) FILTER (WHERE "createdAt" >= ${since7}) AS "last7",
        MAX("createdAt") AS "lastUsedAt"
      FROM "Generation" WHERE ${scope}
      GROUP BY "model", "type", "status" ORDER BY MIN("createdAt")
    `),
    prisma.$queryRaw<TrendAggregate[]>(Prisma.sql`
      SELECT "model", to_char(("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${timezone}, 'YYYY-MM-DD') AS "day",
        COUNT(*) AS "count"
      FROM "Generation" WHERE ${scope} AND "createdAt" >= ${since30}
      GROUP BY "model", "day"
    `),
  ]);

  const modelMap = new Map<
    string,
    {
      model: string;
      total: number;
      last30: number;
      last7: number;
      success: number;
      failed: number;
      categories: Record<string, number>;
      lastUsedAt: string | null;
    }
  >();
  const categoryTotals: Record<string, number> = {};

  for (const row of rows) {
    const model = normalizeModel(row.model);
    const category = typeLabel(row.type);
    const count = Number(row.total);
    const item =
      modelMap.get(model) ||
      {
        model,
        total: 0,
        last30: 0,
        last7: 0,
        success: 0,
        failed: 0,
        categories: {},
        lastUsedAt: null,
      };

    item.total += count;
    item.last30 += Number(row.last30);
    item.last7 += Number(row.last7);
    if (String(row.status || "").toLowerCase() === "success") item.success += count;
    if (String(row.status || "").toLowerCase() === "failed") item.failed += count;
    inc(item.categories, category, count);
    inc(categoryTotals, category, count);
    const lastUsedAt = row.lastUsedAt.toISOString();
    if (!item.lastUsedAt || lastUsedAt > item.lastUsedAt) item.lastUsedAt = lastUsedAt;
    modelMap.set(model, item);
  }

  const models = Array.from(modelMap.values()).sort((a, b) => b.last30 - a.last30 || b.total - a.total || a.model.localeCompare(b.model));
  const topModels = models.filter((item) => item.last30 > 0).slice(0, 6).map((item) => item.model);
  const palette = Object.fromEntries([...topModels, "其他模型"].map((model, index) => [model, COLORS[index % COLORS.length]]));
  const last30 = models.reduce((sum, model) => sum + model.last30, 0);
  const last7 = models.reduce((sum, model) => sum + model.last7, 0);

  return {
    summary: {
      total: models.reduce((sum, model) => sum + model.total, 0),
      last30,
      last7,
      activeModels30: models.filter((item) => item.last30 > 0).length,
      topModel30: models.find((item) => item.last30 > 0)?.model || null,
    },
    palette,
    models,
    categoryTotals: Object.entries(categoryTotals)
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count),
    trend30: buildTrend(trends, 30, topModels),
    trend7: buildTrend(trends, 7, topModels),
  };
}

// Coalesce simultaneous requests, without retaining stale statistics or an
// unbounded per-user cache on the server.
const reads = new Map<number, ReturnType<typeof readModelUsage>>();

export async function GET(request: NextRequest) {
  const headers = { "Cache-Control": "private, no-store" };
  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: apiMessage("m9d4f6d8342c5") }, { status: 401, headers });
  let pending = reads.get(user.id);
  if (!pending) {
    pending = readModelUsage(user.id);
    if (reads.size < 128) reads.set(user.id, pending);
  }
  try {
    return NextResponse.json(await pending, { headers });
  } finally {
    if (reads.get(user.id) === pending) reads.delete(user.id);
  }
}
