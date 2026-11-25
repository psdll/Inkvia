import fs from "fs/promises";
import path from "path";
import prisma from "@/lib/prisma";
import { buildMediaOriginalUrl, isVideoMediaUrl, normalizeMediaUrl } from "@/lib/media-url";
import { resolvePublicPath } from "@/lib/public-path";
import { saveBufferFile, saveRemoteFile } from "@/lib/storage";
import { createMediaLibraryImagePreview, createMediaLibraryVideoPoster } from "@/lib/media-library-thumbnails";
import { extractOssObjectKeyFromUrl } from "@/lib/oss";
import { deleteStoredMediaRefs } from "@/lib/media-cleanup";

const INSPIRATION_OSS_BASE = "inspiration_assets";
const META_KEY_PREFIX = "inspiration_template_meta_";
const INSPIRATION_COPY_CONCURRENCY = 3;
const ALLOWED_DELETE_PREFIXES = [
  "uploads/inspiration_assets/",
  "uploads/template_images/",
  "uploads/template_videos/",
];

type Actor =
  | { kind: "admin"; username?: string | null }
  | { kind: "user"; userId: number; username: string };

type InputCandidateSlot = { options: string[] };

export type UserTemplateUploadRef = {
  templateId: number;
  sourceGenerationId: number;
};

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>
) {
  const results = new Array<R>(items.length);
  const workerCount = Math.min(Math.max(Math.floor(concurrency), 1), items.length);
  let nextIndex = 0;

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        results[currentIndex] = await worker(items[currentIndex], currentIndex);
      }
    })
  );

  return results;
}

function isVideoGenerationType(raw: unknown) {
  const t = String(raw || "").trim().toLowerCase();
  return t === "video_gen" || t === "video_generate";
}

function asToolType(generationType: string, mediaType: "image" | "video") {
  const t = String(generationType || "").trim().toLowerCase();
  if (t === "face_swap") return "face";
  if (t === "image_edit") return "image";
  if (isVideoGenerationType(t)) return "video";
  return mediaType === "video" ? "video" : "image";
}

function parseJsonObject(raw: unknown) {
  const text = String(raw || "").trim();
  if (!text) return null;
  try {
    const obj = JSON.parse(text);
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
    return obj as Record<string, any>;
  } catch {
    return null;
  }
}

function mergeParamsPreferFilled(current: Record<string, any>, incoming: Record<string, any>) {
  const out: Record<string, any> = { ...current };
  for (const [key, nextVal] of Object.entries(incoming || {})) {
    const prevVal = out[key];
    if (prevVal && typeof prevVal === "object" && !Array.isArray(prevVal) && nextVal && typeof nextVal === "object" && !Array.isArray(nextVal)) {
      out[key] = mergeParamsPreferFilled(prevVal as Record<string, any>, nextVal as Record<string, any>);
      continue;
    }
    const prevEmpty = prevVal === null || prevVal === undefined || prevVal === "" || (Array.isArray(prevVal) && prevVal.length === 0);
    if (prevEmpty) out[key] = nextVal;
  }
  return out;
}

function toStringArray(v: unknown) {
  if (!Array.isArray(v)) return [] as string[];
  return v.map((x) => normalizeMediaUrl(x)).filter(Boolean);
}

function pickOutputCandidates(generation: { localPath: string | null; templateData: string | null }) {
  const out: string[] = [];
  const append = (v: unknown) => {
    const s = normalizeMediaUrl(v);
    if (!s) return;
    out.push(buildMediaOriginalUrl(s));
  };
  append(generation.localPath);
  const data = parseJsonObject(generation.templateData);
  if (data) {
    toStringArray(data.outputPaths).forEach(append);
    toStringArray(data.output_images).forEach(append);
    toStringArray(data.image_urls).forEach(append);
    toStringArray(data.resultUrls).forEach(append);
    if (Array.isArray(data.outputs)) {
      for (const item of data.outputs) append((item as any)?.url || (item as any)?.video_url || item);
    }
  }
  return Array.from(new Set(out));
}

function pickInputCandidateSlotsFromParams(data: Record<string, any> | null) {
  const slots: InputCandidateSlot[] = [];
  const toOriginal = (v: unknown) => {
    const s = normalizeMediaUrl(v);
    if (!s) return "";
    return buildMediaOriginalUrl(s);
  };
  const pushSlot = (optionsRaw: unknown[]) => {
    const options = Array.from(new Set(optionsRaw.map((v) => toOriginal(v)).filter(Boolean)));
    if (options.length) slots.push({ options });
  };
  if (!data) return slots;

  const publicInputs = toStringArray(data.inputPublicUrls);
  const imagePaths = toStringArray(data.imagePaths);
  const inputPaths = toStringArray(data.inputPaths);
  const imageUrls = toStringArray(data.image_urls);
  const maxLen = Math.max(publicInputs.length, imagePaths.length, inputPaths.length, imageUrls.length);
  for (let i = 0; i < maxLen; i++) pushSlot([publicInputs[i], imagePaths[i], inputPaths[i], imageUrls[i]]);

  if (Array.isArray(data.inputMedia)) {
    for (const item of data.inputMedia) pushSlot([(item as any)?.url || item]);
  }

  pushSlot([data.facePath]);
  pushSlot([data.targetPath]);
  pushSlot([data.inputUrl]);
  pushSlot([data.mediaPath]);
  pushSlot([data.inputPreviewUrl]);

  const seen = new Set<string>();
  const deduped: InputCandidateSlot[] = [];
  for (const slot of slots) {
    const hasNew = slot.options.some((o) => !seen.has(o));
    if (!hasNew) continue;
    for (const o of slot.options) seen.add(o);
    deduped.push(slot);
  }
  return deduped;
}

async function ensureLocalUrlForTemplate(rawPath: string, mediaType: "image" | "video") {
  const input = buildMediaOriginalUrl(normalizeMediaUrl(rawPath));
  if (!input) throw new Error("素材路径为空");
  const folder = mediaType === "video" ? `${INSPIRATION_OSS_BASE}/videos` : `${INSPIRATION_OSS_BASE}/images`;
  if (input.startsWith("/uploads/")) {
    const safe = input.replaceAll("\\", "/");
    const full = resolvePublicPath(safe.replace(/^\/+/, ""));
    const buffer = await fs.readFile(full);
    return saveBufferFile(buffer, folder, { fileName: path.basename(safe), fallbackExt: mediaType === "video" ? "mp4" : "png" });
  }
  if (/^https?:\/\//i.test(input)) return saveRemoteFile(input, folder, false);
  if (input.startsWith("data:")) return saveRemoteFile(input, folder, true);
  throw new Error("仅支持 /uploads、http(s) 或 data: 素材地址");
}

async function readLocalUploadBuffer(url: string) {
  const normalized = normalizeMediaUrl(url);
  if (!normalized.startsWith("/uploads/")) return null;
  const full = resolvePublicPath(normalized.replace(/^\/+/, ""));
  return fs.readFile(full).catch(() => null);
}

async function createTemplateDisplayAsset(url: string, mediaType: "image" | "video") {
  const buffer = await readLocalUploadBuffer(url);
  if (!buffer?.length) return null;
  if (mediaType === "video") {
    return createMediaLibraryVideoPoster(buffer, {
      folder: `${INSPIRATION_OSS_BASE}/posters`,
      kind: "video",
      sourceName: path.basename(url),
    });
  }
  return createMediaLibraryImagePreview(buffer, {
    folder: `${INSPIRATION_OSS_BASE}/previews`,
    kind: "image",
    sourceName: path.basename(url),
  });
}

async function copyInputAssetsToInspiration(inputSlots: InputCandidateSlot[]) {
  const results = await mapWithConcurrency(inputSlots, INSPIRATION_COPY_CONCURRENCY, async (slot) => {
    let copiedOne = "";
    for (const source of slot.options) {
      try {
        const mediaType: "image" | "video" = isVideoMediaUrl(source) ? "video" : "image";
        const target = await ensureLocalUrlForTemplate(source, mediaType);
        if (target) {
          copiedOne = target;
          break;
        }
      } catch {}
    }
    return copiedOne ? { copied: copiedOne, failedSlot: null } : { copied: "", failedSlot: slot.options };
  });

  const copied = results.map((result) => result.copied).filter(Boolean);
  const failedSlots = results.map((result) => result.failedSlot).filter((slot): slot is string[] => Array.isArray(slot));
  return { copied, failedSlots };
}

async function copyOutputAssetsToInspiration(outputCandidates: string[]) {
  const results = await mapWithConcurrency(outputCandidates, INSPIRATION_COPY_CONCURRENCY, async (source) => {
    try {
      const mediaType: "image" | "video" = isVideoMediaUrl(source) ? "video" : "image";
      const target = await ensureLocalUrlForTemplate(source, mediaType);
      return target || "";
    } catch {}
    return "";
  });
  const copied = results.filter(Boolean);
  return Array.from(new Set(copied));
}

async function cleanupCreatedTemplateRefs(refs: string[], generationId: number) {
  const uniqueRefs = Array.from(new Set(refs.map((ref) => String(ref || "").trim()).filter(Boolean)));
  if (!uniqueRefs.length) return;
  try {
    const result = await deleteStoredMediaRefs(uniqueRefs, { allowMaterialDeletion: true });
    if (result.ossError || result.failedOssKeys.length) {
      console.error("[inspiration-template] rollback cleanup had errors", {
        generationId,
        ossError: result.ossError,
        failedOssKeys: result.failedOssKeys,
      });
    }
  } catch (error) {
    console.error("[inspiration-template] rollback cleanup failed", { generationId, error });
  }
}

function buildTemplateTitle(prompt: string, model: string | null, generationType: string) {
  const line = String(prompt || "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((s) => s.trim())
    .find(Boolean);
  if (line) return line.slice(0, 36);
  const modelText = String(model || "").trim();
  if (modelText) return `${modelText} 模板`;
  return `${generationType || "生成"} 模板`;
}

function metaKey(templateId: number) {
  return `${META_KEY_PREFIX}${templateId}`;
}

function templateIdFromMetaKey(key: string) {
  const id = Number(String(key || "").slice(META_KEY_PREFIX.length));
  return Number.isFinite(id) && id > 0 ? id : 0;
}

export async function getInspirationTemplatesByGenerationIds(generationIds: number[]) {
  const ids = Array.from(new Set(generationIds.map((id) => Math.floor(Number(id))).filter((id) => Number.isFinite(id) && id > 0)));
  const byGenerationId = new Map<number, UserTemplateUploadRef>();
  if (!ids.length) return byGenerationId;

  const rows = await prisma.appSetting.findMany({
    where: { key: { startsWith: META_KEY_PREFIX } },
    select: { key: true, value: true },
  });

  const wanted = new Set(ids);
  for (const row of rows) {
    const meta = parseJsonObject(row.value);
    const sourceGenerationId = Number(meta?.sourceGenerationId);
    if (!wanted.has(sourceGenerationId)) continue;
    const templateId = templateIdFromMetaKey(row.key);
    if (!templateId || byGenerationId.has(sourceGenerationId)) continue;
    byGenerationId.set(sourceGenerationId, { templateId, sourceGenerationId });
  }
  return byGenerationId;
}

export async function getUserInspirationTemplatesByGenerationIds(userId: number, generationIds: number[]) {
  const ids = Array.from(new Set(generationIds.map((id) => Math.floor(Number(id))).filter((id) => Number.isFinite(id) && id > 0)));
  const byGenerationId = new Map<number, UserTemplateUploadRef>();
  if (!userId || !ids.length) return byGenerationId;

  const rows = await prisma.appSetting.findMany({
    where: {
      key: { startsWith: META_KEY_PREFIX },
      value: { contains: `"createdByUserId":${userId}` },
    },
    select: { key: true, value: true },
  });

  const wanted = new Set(ids);
  for (const row of rows) {
    const meta = parseJsonObject(row.value);
    if (meta?.source !== "user_generation") continue;
    if (Number(meta.createdByUserId) !== userId) continue;
    const sourceGenerationId = Number(meta.sourceGenerationId);
    if (!wanted.has(sourceGenerationId)) continue;
    const templateId = templateIdFromMetaKey(row.key);
    if (!templateId || byGenerationId.has(sourceGenerationId)) continue;
    byGenerationId.set(sourceGenerationId, { templateId, sourceGenerationId });
  }
  return byGenerationId;
}

export async function getUserInspirationTemplateForGeneration(userId: number, generationId: number) {
  const generation = await prisma.generation.findFirst({
    where: {
      id: generationId,
      OR: [
        { authUserId: userId },
        { AND: [{ authUserId: null }, { userId: String(userId) }] },
      ],
    },
    select: {
      id: true,
      externalTaskId: true,
      userId: true,
      authUserId: true,
    },
  });
  if (!generation) return null;

  const peers = generation.externalTaskId
    ? await prisma.generation.findMany({
        where: {
          externalTaskId: generation.externalTaskId,
          userId: generation.userId,
          ...(typeof generation.authUserId === "number" ? { authUserId: generation.authUserId } : {}),
        } as any,
        select: { id: true },
        orderBy: { createdAt: "asc" },
        take: 20,
      })
    : [];

  const ids = Array.from(new Set([generation.id, ...peers.map((x) => x.id)]));
  const byGenerationId = await getUserInspirationTemplatesByGenerationIds(userId, ids);
  return ids.map((id) => byGenerationId.get(id)).find(Boolean) || null;
}

async function findExistingUserTemplate(userId: number, generationId: number) {
  const ref = await getUserInspirationTemplateForGeneration(userId, generationId);
  if (!ref) return null;
  const template = await prisma.template.findUnique({
    where: { id: ref.templateId },
    include: { tags: { include: { tag: true } } },
  });
  return template ? { template, templateId: ref.templateId } : null;
}

export async function createInspirationTemplateFromGeneration(generationId: number, actor: Actor) {
  if (!Number.isFinite(generationId) || generationId <= 0) {
    return { ok: false as const, status: 400, error: "generationId 无效" };
  }

  if (actor.kind === "user") {
    const existing = await findExistingUserTemplate(actor.userId, generationId);
    if (existing) {
      return {
        ok: true as const,
        alreadyExists: true,
        data: {
          ...existing.template,
          tags: existing.template.tags.map((x) => x.tag.name),
        },
      };
    }
  }

  const generation = actor.kind === "user"
    ? await prisma.generation.findFirst({
        where: {
          id: generationId,
          OR: [
            { authUserId: actor.userId },
            { AND: [{ authUserId: null }, { userId: String(actor.userId) }] },
          ],
        },
        select: {
          id: true,
          type: true,
          prompt: true,
          model: true,
          localPath: true,
          templateData: true,
          status: true,
          externalTaskId: true,
          userId: true,
          authUserId: true,
        },
      })
    : await prisma.generation.findUnique({
        where: { id: generationId },
        select: {
          id: true,
          type: true,
          prompt: true,
          model: true,
          localPath: true,
          templateData: true,
          status: true,
          externalTaskId: true,
          userId: true,
          authUserId: true,
        },
      });
  if (!generation) return { ok: false as const, status: 404, error: "资产不存在" };

  const peers = generation.externalTaskId
    ? await prisma.generation.findMany({
        where: {
          externalTaskId: generation.externalTaskId,
          userId: generation.userId,
          ...(typeof generation.authUserId === "number" ? { authUserId: generation.authUserId } : {}),
        } as any,
        select: { id: true, localPath: true, templateData: true },
        orderBy: { createdAt: "asc" },
        take: 20,
      })
    : [];

  const generationIds = Array.from(new Set([generation.id, ...peers.map((x) => x.id)]));
  const logRows = await prisma.log.findMany({
    where: {
      generationId: { in: generationIds },
      action: { in: ["task_create", "task_success"] },
      metadata: { not: null },
    },
    select: { metadata: true },
    orderBy: { createdAt: "asc" },
    take: 100,
  });

  let mergedParams: Record<string, any> = {};
  const snapshots = [generation.templateData, ...peers.map((x) => x.templateData), ...logRows.map((x) => x.metadata)];
  for (const raw of snapshots) {
    const parsed = parseJsonObject(raw);
    if (!parsed) continue;
    mergedParams = mergeParamsPreferFilled(mergedParams, parsed);
  }

  const outputRaw = [generation, ...peers].map((x) => pickOutputCandidates({ localPath: x.localPath, templateData: x.templateData })).flat();
  const outputCandidates = Array.from(new Set(outputRaw));
  if (!outputCandidates.length) return { ok: false as const, status: 400, error: "该资产没有可用的输出素材" };

  const inputSlots = pickInputCandidateSlotsFromParams(mergedParams);
  const preferredVideo = isVideoGenerationType(generation.type);
  const picked = preferredVideo
    ? outputCandidates.find((x) => isVideoMediaUrl(x)) || outputCandidates[0]
    : outputCandidates.find((x) => !isVideoMediaUrl(x)) || outputCandidates[0];
  const mediaType: "image" | "video" = isVideoMediaUrl(picked) ? "video" : "image";
  if (generation.type === "face_swap") return { ok: false as const, status: 400, error: "该创作工具已停用，历史作品仍可查看和下载" };
  const toolType = asToolType(generation.type, mediaType);
  const createdRefs: string[] = [];

  try {
    const outputOssPaths = await copyOutputAssetsToInspiration(outputCandidates);
    createdRefs.push(...outputOssPaths);

    let ossUrl = outputOssPaths.find((x) => (mediaType === "video" ? isVideoMediaUrl(x) : !isVideoMediaUrl(x))) || outputOssPaths[0];
    if (!ossUrl) {
      try {
        ossUrl = await ensureLocalUrlForTemplate(picked, mediaType);
        outputOssPaths.push(ossUrl);
        createdRefs.push(ossUrl);
      } catch (e: any) {
        await cleanupCreatedTemplateRefs(createdRefs, generation.id);
        return { ok: false as const, status: 400, error: `主结果素材复制失败：${String(e?.message || "未知错误")}` };
      }
    }

    const inputCopy = await copyInputAssetsToInspiration(inputSlots);
    const inputOssPaths = inputCopy.copied;
    createdRefs.push(...inputOssPaths);
    if (inputSlots.length > 0 && inputCopy.failedSlots.length > 0) {
      await cleanupCreatedTemplateRefs(createdRefs, generation.id);
      return {
        ok: false as const,
        status: 400,
        error: `输入素材复制不完整（成功 ${inputOssPaths.length}/${inputSlots.length}），请重试`,
      };
    }

    const displayAssetUrl = await createTemplateDisplayAsset(ossUrl, mediaType);
    if (!displayAssetUrl) {
      await cleanupCreatedTemplateRefs(createdRefs, generation.id);
      return { ok: false as const, status: 500, error: "预览生成失败，请重试" };
    }
    createdRefs.push(displayAssetUrl);

    const prompt = String(generation.prompt || mergedParams.prompt || "").trim() || "无提示词";
    const title = buildTemplateTitle(prompt, generation.model, generation.type);
    const tags = Array.from(
      new Set(
        [
          toolType === "face" ? "人脸替换" : toolType === "video" ? "视频创作" : "图片设计",
          String(generation.model || "").trim(),
        ].filter(Boolean)
      )
    ).slice(0, 8);

    const created = await prisma.$transaction(async (tx) => {
      const template = await tx.template.create({
        data: {
          title,
          prompt,
          description: `来源资产 #${generation.id}`,
          toolType,
          mediaType,
          previewImagePath: displayAssetUrl,
          previewVideoPath: mediaType === "video" ? ossUrl : null,
          tags: {
            create: tags.map((name) => ({
              tag: {
                connectOrCreate: {
                  where: { name },
                  create: { name },
                },
              },
            })),
          },
        },
        include: { tags: { include: { tag: true } } },
      });

      const detailPayload = {
        version: 1,
        source: actor.kind === "user" ? "user_generation" : "admin_generation",
        sourceGenerationId: generation.id,
        sourceTaskType: generation.type,
        model: generation.model || null,
        prompt,
        params: mergedParams,
        inputPaths: inputOssPaths,
        outputPaths: outputOssPaths,
        ...(actor.kind === "user" ? { createdByUserId: actor.userId, createdByUsername: actor.username } : {}),
        ...(actor.kind === "admin" && actor.username ? { createdByAdmin: actor.username } : {}),
        createdAt: new Date().toISOString(),
      };
      await tx.appSetting.upsert({
        where: { key: metaKey(template.id) },
        update: { value: JSON.stringify(detailPayload) },
        create: { key: metaKey(template.id), value: JSON.stringify(detailPayload) },
      });

      return template;
    });

    return {
      ok: true as const,
      alreadyExists: false,
      data: {
        ...created,
        tags: created.tags.map((x) => x.tag.name),
      },
    };
  } catch (e: any) {
    await cleanupCreatedTemplateRefs(createdRefs, generation.id);
    return { ok: false as const, status: 500, error: String(e?.message || "上传灵感失败") };
  }
}

function toDeleteStringArray(value: unknown) {
  if (!Array.isArray(value)) return [] as string[];
  return value.map((x) => String(x || "").trim()).filter(Boolean);
}

export function getTemplateSourceLabel(meta: Record<string, any> | null | undefined) {
  if (meta?.source === "user_generation") {
    const username = String(meta.createdByUsername || "").trim();
    return username ? `用户上传：${username}` : "用户上传";
  }
  if (meta?.source === "admin_generation" || meta?.sourceGenerationId) return "管理员传入";
  if (meta?.source === "admin_custom_upload") return "管理员上传";
  return "管理员上传";
}

export async function loadTemplateMetaByIds(templateIds: number[]) {
  const ids = Array.from(new Set(templateIds.map((id) => Math.floor(Number(id))).filter((id) => Number.isFinite(id) && id > 0)));
  if (!ids.length) return new Map<number, Record<string, any> | null>();
  const rows = await prisma.appSetting.findMany({
    where: { key: { in: ids.map(metaKey) } },
    select: { key: true, value: true },
  });
  const out = new Map<number, Record<string, any> | null>();
  for (const id of ids) out.set(id, null);
  for (const row of rows) out.set(templateIdFromMetaKey(row.key), parseJsonObject(row.value));
  return out;
}

export async function deleteInspirationTemplate(templateId: number, actor: Actor) {
  const id = Number(templateId);
  if (!Number.isFinite(id)) return { ok: false as const, status: 404, error: "模板不存在" };

  const found = await prisma.template.findUnique({
    where: { id },
    select: { id: true, previewImagePath: true, previewVideoPath: true },
  });
  if (!found) return { ok: false as const, status: 404, error: "模板不存在" };

  const metaSetting = await prisma.appSetting.findUnique({
    where: { key: metaKey(id) },
    select: { value: true },
  });
  const meta = parseJsonObject(metaSetting?.value);
  if (actor.kind === "user") {
    if (meta?.source !== "user_generation" || Number(meta.createdByUserId) !== actor.userId) {
      return { ok: false as const, status: 403, error: "只能删除自己上传的灵感模板" };
    }
  }

  const metaUrls = [...toDeleteStringArray(meta?.inputPaths), ...toDeleteStringArray(meta?.outputPaths)];
  const urls = [found.previewImagePath, found.previewVideoPath, ...metaUrls].map((x) => String(x || "").trim()).filter(Boolean);
  const objectKeys = urls.map((u) => extractOssObjectKeyFromUrl(u)).filter(Boolean);
  if (urls.length > 0 && objectKeys.length !== urls.length) {
    return { ok: false as const, status: 400, error: "检测到非 OSS 素材地址，已阻止删除" };
  }
  if (objectKeys.some((key) => !ALLOWED_DELETE_PREFIXES.some((prefix) => String(key || "").startsWith(prefix)))) {
    return { ok: false as const, status: 400, error: "仅允许删除灵感模板目录素材（含历史目录）" };
  }
  if (objectKeys.length > 0) {
    await deleteStoredMediaRefs(urls, { allowMaterialDeletion: true });
  }
  await prisma.appSetting.delete({ where: { key: metaKey(id) } }).catch(() => null);
  await prisma.template.delete({ where: { id } });
  return { ok: true as const, data: { id, deletedCount: objectKeys.length } };
}
