import prisma from "@/lib/prisma";
import { normalizeMediaUrl } from "@/lib/media-url";

// 列表卡片只需要的字段。Tags / description / prompt 都推迟到详情弹窗才拉,
// 避免列表接口随模版数量线性变重。
export type HomeInspirationTemplate = {
  id: number;
  title: string;
  toolType: "image" | "video";
  mediaType: "image" | "video";
  previewImagePath: string | null;
  previewVideoPath: string | null;
  createdAt?: string;
};

function toCard(item: {
  id: number;
  title: string;
  toolType: string;
  mediaType: string;
  previewImagePath: string | null;
  previewVideoPath: string | null;
  createdAt: Date | string;
}): HomeInspirationTemplate | null {
  if (item.toolType !== "image" && item.toolType !== "video") return null;
  if (item.mediaType !== "image" && item.mediaType !== "video") return null;
  return {
    id: item.id,
    title: item.title,
    toolType: item.toolType,
    mediaType: item.mediaType,
    previewImagePath: item.previewImagePath ? normalizeMediaUrl(item.previewImagePath) : null,
    previewVideoPath: item.previewVideoPath ? normalizeMediaUrl(item.previewVideoPath) : null,
    createdAt: item.createdAt instanceof Date ? item.createdAt.toISOString() : String(item.createdAt),
  };
}

/**
 * 首屏初始模版列表。
 *
 * 设计取舍:
 *   - 只取 30 条,够首屏 + 一小段下滚。剩下的由客户端 useInfiniteQuery 分页拉。
 *   - select 投影到卡片所需字段,跳过 description / prompt / tags(详情才需要)。
 *   - 配合 `revalidate = 60` ISR,DB 实际查询每分钟最多一次。
 */
export async function getHomeInspirationTemplates(take = 30): Promise<HomeInspirationTemplate[]> {
  const items = await prisma.template.findMany({
    where: { toolType: { in: ["image", "video"] } },
    take,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: {
      id: true,
      title: true,
      toolType: true,
      mediaType: true,
      previewImagePath: true,
      previewVideoPath: true,
      createdAt: true,
    },
  });
  return items.map(toCard).filter(Boolean) as HomeInspirationTemplate[];
}
