import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

const TOOL_TYPES = ["face", "image", "video"] as const;
const MEDIA_TYPES = ["image", "video"] as const;

function asToolType(value: string | null) {
  if (!value) return null;
  if ((TOOL_TYPES as readonly string[]).includes(value)) return value as (typeof TOOL_TYPES)[number];
  return null;
}

function asMediaType(value: string | null) {
  if (!value) return null;
  if ((MEDIA_TYPES as readonly string[]).includes(value)) return value as (typeof MEDIA_TYPES)[number];
  return null;
}

function asNumber(value: string | null, fallback: number) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.floor(n);
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") || "").trim();
  const toolType = asToolType(searchParams.get("toolType"));
  const mediaType = asMediaType(searchParams.get("mediaType"));
  const category = (searchParams.get("category") || "").trim();
  const tag = (searchParams.get("tag") || "").trim();
  const take = Math.min(asNumber(searchParams.get("take"), 24), 60);
  const skip = asNumber(searchParams.get("skip"), 0);
  // mode=card 仅返回卡片所需字段,完全跳过 tags join,首页灵感发现专用。
  // 兼容老调用方:不传 mode 时维持原行为(含 tags / description / prompt 等全字段)。
  const mode = (searchParams.get("mode") || "").trim().toLowerCase();
  const isCardMode = mode === "card";

  const where: any = { toolType: { in: ["image", "video"] } };

  if (q) {
    where.OR = [
      { title: { contains: q } },
      { description: { contains: q } },
      { prompt: { contains: q } }
    ];
  }
  if (category) where.category = category;
  if (toolType) where.toolType = toolType === "face" ? { in: [] } : toolType;
  if (mediaType) where.mediaType = mediaType;
  if (tag) where.tags = { some: { tag: { name: tag } } };

  let items: any[];
  let total: number;
  let version = "";
  if (isCardMode) {
    const [cardItems, cardTotal, latest] = await Promise.all([
      prisma.template.findMany({
        where,
        take,
        skip,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: {
          id: true,
          title: true,
          category: true,
          toolType: true,
          mediaType: true,
          previewImagePath: true,
          previewVideoPath: true,
          createdAt: true,
        },
      }),
      prisma.template.count({ where }),
      prisma.template.findFirst({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: { id: true, createdAt: true },
      }),
    ]);
    items = cardItems;
    total = cardTotal;
    version = `${total}:${latest?.id || 0}:${latest?.createdAt instanceof Date ? latest.createdAt.toISOString() : ""}`;
  } else {
    [items, total] = await Promise.all([
      prisma.template.findMany({
        where,
        take,
        skip,
        // 首页模板列表按时间倒序展示
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        include: { tags: { include: { tag: true } } }
      }),
      prisma.template.count({ where })
    ]);
  }

  const categoryRows = await prisma.template.groupBy({
    by: ["category"],
    where: { category: { not: null } },
    orderBy: { category: "asc" },
  });
  const categories = categoryRows.map((row) => row.category).filter((name): name is string => Boolean(name));

  const response = NextResponse.json({
    success: true,
    data: isCardMode
      ? items
      : items.map((t) => ({
          ...t,
          tags: t.tags.map((x: any) => x.tag.name)
        })),
    meta: isCardMode ? { total, take, skip, version, categories } : { total, take, skip, categories }
  });
  response.headers.set(
    "Cache-Control",
    isCardMode
      ? "public, max-age=60, stale-while-revalidate=3600"
      : "public, max-age=60, stale-while-revalidate=300"
  );
  return response;
}
