import { isSeedream55Model } from "@/lib/volcengine-seedream-55";
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { getUserId } from "@/lib/server-auth";
import { getGenerationDisplayFields } from "@/lib/generation-display-assets";
import { normalizeMediaUrl } from "@/lib/media-url";
import { canvasHistoryReferences } from "./canvas-history";

const mediaExtensions = [".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif", ".bmp", ".mp4", ".webm", ".mov", ".m4v", ".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac"];
const videoWhere: Prisma.GenerationWhereInput = { OR: [{ type: { in: ["video_gen", "video_generate"] } }, ...[".mp4", ".webm", ".mov", ".m4v"].map(ext => ({ localPath: { endsWith: ext } }))] };
const audioWhere: Prisma.GenerationWhereInput = { OR: [{ type: "audio_gen" }, ...[".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac"].map(ext => ({ localPath: { endsWith: ext } }))] };
const select = { id: true, canvasId: true, type: true, createdAt: true, localPath: true, templateData: true } satisfies Prisma.GenerationSelect;
const headers = { "Cache-Control": "private, no-store" };

function parseParams(raw: string | null): Record<string, any> {
  try { const value = JSON.parse(raw || "{}"); return value && typeof value === "object" && !Array.isArray(value) ? value : {}; } catch { return {}; }
}

function serialize(row: Prisma.GenerationGetPayload<{ select: typeof select }>) {
  const { templateData, ...rest } = row;
  return { ...rest, createdAt: row.createdAt.toISOString(), localPath: normalizeMediaUrl(row.localPath || ""), ...getGenerationDisplayFields(row) };
}

export function canvasHistoryWhere(authUserId: number, canvasId: number | null): Prisma.GenerationWhereInput {
  return {
    authUserId, status: "success",
    OR: [{ source: "canvas" }, { source: "agent", canvasId: { not: null } }],
    ...(canvasId ? { canvasId } : {}),
    AND: [{ NOT: { localPath: { contains: "/canvas_voice_previews/" } } }, { OR: mediaExtensions.map(ext => ({ localPath: { endsWith: ext } })) }],
  };
}

export async function getCanvasAssetHistory(req: NextRequest, verifiedOwnerId?: number) {
  const authUserId = verifiedOwnerId ?? await getUserId(req);
  if (!authUserId) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  const params = req.nextUrl.searchParams;
  const rawCanvas = params.get("canvasId");
  const canvasId = rawCanvas === null ? null : Number(rawCanvas);
  if (canvasId !== null && (!Number.isSafeInteger(canvasId) || canvasId < 1)) return NextResponse.json({ error: "画布参数无效" }, { status: 400 });
  const base = canvasHistoryWhere(authUserId, canvasId);
  const filters = { image: { NOT: [videoWhere, audioWhere] }, video: { AND: [videoWhere, { NOT: audioWhere }] }, audio: audioWhere };
  if (params.get("count") === "1") {
    const [image, video, audio] = await Promise.all(Object.values(filters).map(filter => prisma.generation.count({ where: { AND: [base, filter] } })));
    return NextResponse.json({ image, video, audio }, { headers });
  }
  const kind = params.get("type") || "image";
  if (!Object.hasOwn(filters, kind)) return NextResponse.json({ error: "媒体分类无效" }, { status: 400 });
  const order = params.get("order") === "asc" ? "asc" : "desc";
  const take = Math.min(80, Math.max(1, Number(params.get("take")) || 60));
  const where: Prisma.GenerationWhereInput = { AND: [base, filters[kind as keyof typeof filters]] };
  const cursor = params.get("cursor");
  if (cursor) {
    try {
      const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
      const date = new Date(parsed.createdAt);
      if (!Number.isSafeInteger(parsed.id) || parsed.id < 1 || !Number.isFinite(date.getTime()) || parsed.order !== order || parsed.kind !== kind || parsed.canvasId !== canvasId) throw new Error();
      const compare = order === "asc" ? "gt" : "lt";
      (where.AND as Prisma.GenerationWhereInput[]).push({ OR: [{ createdAt: { [compare]: date } }, { createdAt: date, id: { [compare]: parsed.id } }] });
    } catch { return NextResponse.json({ error: "分页参数无效，请刷新后重试" }, { status: 400 }); }
  }
  const rows = await prisma.generation.findMany({ where, select, orderBy: [{ createdAt: order }, { id: order }], take: Math.floor(take) + 1 });
  const hasMore = rows.length > take;
  const items = rows.slice(0, take).map(serialize);
  const last = items.at(-1);
  const nextCursor = hasMore && last ? Buffer.from(JSON.stringify({ id: last.id, createdAt: last.createdAt, order, kind, canvasId })).toString("base64url") : null;
  return NextResponse.json({ items, nextCursor, hasMore }, { headers });
}

export async function getCanvasAssetDetail(req: NextRequest, id: number, verifiedOwnerId?: number) {
  const authUserId = verifiedOwnerId ?? await getUserId(req);
  if (!authUserId) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  if (!Number.isSafeInteger(id) || id < 1) return NextResponse.json({ error: "素材参数无效" }, { status: 400 });
  const row = await prisma.generation.findFirst({ where: { ...canvasHistoryWhere(authUserId, null), id }, select: { ...select, prompt: true, model: true, authUser: { select: { username: true } } } });
  if (!row) return NextResponse.json({ error: "素材不存在或已删除" }, { status: 404 });
  const [inputs, logs] = await Promise.all([
    prisma.generationInputMedia.findMany({ where: { generationId: id, media: { ownerUserId: authUserId, status: "ready", purgedAt: null } }, orderBy: { position: "asc" }, select: { role: true, media: { select: { originalKey: true, publicUrl: true, kind: true } } } }),
    prisma.log.findMany({ where: { generationId: id, userId: String(authUserId), category: "generation", action: { in: ["task_create", "task_success"] } }, orderBy: { createdAt: "asc" }, select: { metadata: true }, take: 20 }),
  ]);
  const metadata = Object.assign({}, ...logs.map(log => parseParams(log.metadata)), parseParams(row.templateData));
  if (inputs.length) metadata.inputMedia = inputs.map(input => ({ url: input.media.originalKey || input.media.publicUrl, kind: input.media.kind, role: input.role }));
  const params: Record<string, string | number | boolean> = {};
  for (const key of ["aspectRatio", "ratio", "resolution", "customSize", "quality", "duration", "durationSeconds", "seed", "generateAudio", "voiceId", "speed", "pitch", "volume", "audioFormat", "sampleRate"]) {
    if (["string", "number", "boolean"].includes(typeof metadata[key])) params[key] = metadata[key];
  }
  if (metadata.sunoRequest && typeof metadata.sunoRequest === "object") {
    for (const [key, value] of Object.entries(metadata.sunoRequest)) {
      if (!["prompt", "model"].includes(key) && ["string", "number", "boolean"].includes(typeof value)) params[key] = value as string | number | boolean;
    }
  }
  return NextResponse.json({ item: { ...serialize(row), prompt: row.prompt || String(metadata.prompt || metadata.text || ""), model: row.model, gptImage25Mode: metadata.gptImage25Mode === "sunburst" ? "sunburst" : metadata.gptImage25Mode === "flare" ? "flare" : undefined, creator: row.authUser?.username || null, params, googleGrounding: metadata.googleGrounding, seedream55Output: isSeedream55Model(row.model) ? metadata.seedream55Output : undefined, references: canvasHistoryReferences(metadata) } }, { headers });
}
