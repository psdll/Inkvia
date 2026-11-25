import "server-only";
import prisma from "@/lib/prisma";

/**
 * Agent 合成的成片没有媒体库记录：记下“哪个画布的哪个节点对应哪个本地文件”，
 * 之后拆解、再合成时按这条记录找文件，不信任节点上可被改写的地址。
 */
const key = (canvasId: number, nodeId: string) => `creative-agent:composed:v1:${canvasId}:${nodeId}`;

export async function recordComposedMedia(canvasId: number, nodeId: string, value: { url: string; actorUserId: number }) {
  const record = JSON.stringify(value);
  await prisma.appSetting.upsert({ where: { key: key(canvasId, nodeId) }, create: { key: key(canvasId, nodeId), value: record }, update: { value: record } });
}

export async function composedMediaUrl(canvasId: number, nodeId: string, nodeUrl: string | undefined) {
  const row = await prisma.appSetting.findUnique({ where: { key: key(canvasId, nodeId) } });
  if (!row) return undefined;
  try {
    const { url } = JSON.parse(row.value) as { url?: string };
    return url && url === nodeUrl && url.startsWith("/uploads/") ? url : undefined;
  } catch { return undefined; }
}
