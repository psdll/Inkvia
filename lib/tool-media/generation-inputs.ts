import { platformHandlesMedia, platformReadsLocalFile, resolveMediaForPlatform, type MediaDeliveryTarget } from "@/lib/media-delivery/deliver";
import type { MediaKind } from "@/lib/media-delivery/catalog";
import { getMediaDeliveryMode } from "@/lib/media-delivery/settings";
import path from "node:path";

import { Prisma, type PrismaClient } from "@prisma/client";
import prisma from "@/lib/prisma";
import {
  buildAppPublicUploadUrl,
  resolveLocalUploadPathForExternalApiWithRelay,
} from "@/lib/external-assets";
import {
  buildOssObjectPublicUrl,
  deleteOssObjects,
  isOssPublicUrlConfigured,
  resolveOssObjectUrlForExternalApi,
} from "@/lib/oss";
import {
  isToolInputMedia,
  isToolMediaLocalPath,
} from "@/lib/tool-media/lifecycle";
import {
  assertGenerationInputManifestMatches,
  interleaveGenerationInputValues,
  type GenerationInputManifestV1,
} from "@/lib/generation/input-manifest";
import {
  getSeedanceMediaPolicy,
  type SeedanceMediaKind,
  type SeedanceMediaProbe,
} from "@/lib/seedance-media-policy";
import { getMiniMaxH3UploadContract } from "@/lib/minimax-h3-media-policy";
import { isWanVideoModel } from "@/lib/wan-models";
import {
  mergeStoredMediaProbe,
  probeLocalMedia,
  readStoredMediaProbe,
  resolveLocalUploadPath,
} from "@/lib/tool-media/media-probe";

type ToolMediaRow = {
  id: string;
  ownerUserId: number | null;
  kind: string;
  status: string;
  originalName: string | null;
  declaredMime: string | null;
  detectedMime: string | null;
  sizeBytes: bigint | number | null;
  originalKey: string | null;
  variants: unknown;
  metadata: unknown;
};

export type GenerationToolMediaInput = {
  mediaId: string;
  kind: string;
  localPath: string;
  modelUrl: string;
  position: number;
  relayObjectKey?: string;
  fileName?: string;
  byteSize?: number;
  probe?: SeedanceMediaProbe;
  preparedForPlatform?: true;
};

export function buildToolMediaLogMetadata(inputs: GenerationToolMediaInput[]) {
  return {
    toolMediaCount: inputs.length,
    toolMedia: inputs.map(({ mediaId, kind, localPath, position }) => ({
      mediaId,
      kind,
      localPath,
      position,
    })),
  };
}

type ToolMediaClient = Pick<
  PrismaClient,
  "$queryRaw" | "$transaction" | "mediaAsset"
>;

const TOOL_MEDIA_RELAY_FOLDER = "tool-input-relay";

export class ToolMediaInputError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "ToolMediaInputError";
    this.status = status;
  }
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function normalizeToolMediaIds(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const id = String(value || "")
      .trim()
      .toLowerCase();
    if (!id) continue;
    if (!UUID_PATTERN.test(id))
      throw new ToolMediaInputError("素材 ID 格式不正确");
    if (seen.has(id)) throw new ToolMediaInputError("素材 ID 不能重复");
    seen.add(id);
    result.push(id);
  }
  return result;
}

function normalizeToolMediaPositions(ids: string[], values?: number[]) {
  const positions = values ?? ids.map((_id, index) => index);
  if (
    positions.length !== ids.length ||
    positions.some(
      (position) => !Number.isInteger(position) || position < 0,
    )
  ) {
    throw new ToolMediaInputError("素材位置格式不正确");
  }
  if (new Set(positions).size !== positions.length) {
    throw new ToolMediaInputError("素材位置不能重复");
  }
  return positions;
}

export function parseToolMediaIdsFromFormData(formData: FormData): string[] {
  const raw = ["toolMediaId", "toolMediaId[]", "toolMediaIds", "toolMediaIds[]"]
    .flatMap((name) => formData.getAll(name))
    .flatMap((value) => {
      const text = String(value || "").trim();
      if (!text) return [];
      if (!text.startsWith("[")) return [text];
      try {
        const parsed = JSON.parse(text);
        return Array.isArray(parsed) ? parsed : [text];
      } catch {
        return [text];
      }
    });
  return normalizeToolMediaIds(raw);
}

function relayObjectKey(variants: unknown) {
  if (!variants || typeof variants !== "object" || !("relay" in variants))
    return "";
  const relay = variants.relay;
  if (!relay || typeof relay !== "object" || !("objectKey" in relay)) return "";
  return String(relay.objectKey || "").trim();
}

async function toGenerationInput(
  row: ToolMediaRow,
  position: number,
  probe?: SeedanceMediaProbe,
): Promise<GenerationToolMediaInput> {
  const localPath = String(row.originalKey || "").trim();
  const relayKey = relayObjectKey(row.variants);
  const modelUrl = relayKey
    ? await isOssPublicUrlConfigured()
      ? await buildOssObjectPublicUrl(relayKey)
      : ""
    : buildAppPublicUploadUrl(localPath);
  return {
    mediaId: row.id,
    kind: row.kind,
    localPath,
    modelUrl,
    position,
    ...(row.originalName ? { fileName: row.originalName } : {}),
    ...(row.sizeBytes !== null && Number.isSafeInteger(Number(row.sizeBytes))
      ? { byteSize: Number(row.sizeBytes) }
      : {}),
    ...(probe ? { probe } : {}),
    ...(relayKey ? { relayObjectKey: relayKey } : {}),
  };
}

function isSeedanceMediaKind(value: string): value is SeedanceMediaKind {
  return value === "image" || value === "video" || value === "audio";
}

async function ensureVideoModelProbe(
  row: ToolMediaRow,
  client: Pick<PrismaClient, "mediaAsset">,
  modelId?: string,
): Promise<SeedanceMediaProbe | undefined> {
  if (!modelId) return undefined;
  const seedancePolicy = getSeedanceMediaPolicy(modelId);
  const miniMaxContract = getMiniMaxH3UploadContract(modelId);
  if (!seedancePolicy && !miniMaxContract && !isWanVideoModel(modelId)) return undefined;
  const stored = readStoredMediaProbe(row.metadata);
  if (stored) return stored;
  if (seedancePolicy && process.env.SEEDANCE_MEDIA_VALIDATION_DISABLED === "1") return undefined;
  if (!isSeedanceMediaKind(row.kind)) {
    throw new ToolMediaInputError("素材类型无法进行视频模型合规检测");
  }
  const localPath = resolveLocalUploadPath(String(row.originalKey || ""));
  const probe = await probeLocalMedia({
    localPath,
    kind: row.kind,
    fileName: String(row.originalName || path.basename(localPath)),
    declaredMime: String(row.declaredMime || row.detectedMime || ""),
  });
  const updated = await client.mediaAsset.updateMany({
    where: { id: row.id, status: "ready" },
    data: {
      detectedMime: probe.detectedMime,
      metadata: mergeStoredMediaProbe(row.metadata, probe) as Prisma.InputJsonValue,
    },
  });
  if (updated.count !== 1) {
    throw new ToolMediaInputError("素材状态已变化，请重新提交", 409);
  }
  return probe;
}

async function validateRows(
  rows: ToolMediaRow[],
  ids: string[],
  positions: number[],
  ownerUserId: number,
  allowMissingModelUrl = false,
  client: Pick<PrismaClient, "mediaAsset">,
  modelId?: string,
) {
  const byId = new Map(rows.map((row) => [row.id.toLowerCase(), row]));
  const ordered = ids.map((id) => byId.get(id));
  if (ordered.some((row) => !row)) {
    throw new ToolMediaInputError("素材不存在或已删除");
  }
  if (ordered.some((row) => row!.ownerUserId !== ownerUserId)) {
    throw new ToolMediaInputError("无权使用该素材", 403);
  }
  if (ordered.some((row) => row!.status !== "ready")) {
    throw new ToolMediaInputError("素材尚未就绪或已删除");
  }
  if (ordered.some((row) => !isToolMediaLocalPath(row!.originalKey))) {
    throw new ToolMediaInputError("素材缺少本地源文件");
  }
  if (ordered.some((row) => !isToolInputMedia(row!.metadata))) {
    throw new ToolMediaInputError("素材不是工具上传素材");
  }
  const inputs = await Promise.all(
    ordered.map(async (row, index) => {
      const probe = await ensureVideoModelProbe(row!, client, modelId);
      return toGenerationInput(row!, positions[index], probe);
    }),
  );
  if (!allowMissingModelUrl && inputs.some((input) => !input.modelUrl)) {
    throw new ToolMediaInputError("素材缺少可供模型访问的 URL");
  }
  return inputs;
}

async function rebuildMissingToolMediaUrls(
  client: Pick<PrismaClient, "mediaAsset">,
  inputs: GenerationToolMediaInput[],
  mediaDeliveryTarget?: MediaDeliveryTarget | null,
) {
  const createdRelayObjectKeys: string[] = [];
  const rebuiltInputs: GenerationToolMediaInput[] = [];
  try {
    for (const input of inputs) {
      if (input.modelUrl) {
        rebuiltInputs.push(input);
        continue;
      }
      if (isMediaKind(input.kind) && platformReadsLocalFile(mediaDeliveryTarget, input.kind)) {
        rebuiltInputs.push(input.modelUrl ? input : { ...input, modelUrl: input.localPath });
        continue;
      }
      // The target platform hosts this file itself (or takes Base64); no Aliyun OSS relay needed.
      if (isMediaKind(input.kind) && await platformHandlesMedia(mediaDeliveryTarget, input.kind)) {
        rebuiltInputs.push(input.modelUrl ? input : { ...input, modelUrl: input.localPath });
        continue;
      }
      if (input.relayObjectKey) {
        const modelUrl = await resolveOssObjectUrlForExternalApi(
          input.relayObjectKey,
        );
        if (!modelUrl) {
          throw new ToolMediaInputError("无法恢复可供模型访问的素材 URL", 503);
        }
        rebuiltInputs.push({ ...input, modelUrl });
        continue;
      }
      const relay = await resolveLocalUploadPathForExternalApiWithRelay(
        input.localPath,
        TOOL_MEDIA_RELAY_FOLDER,
      );
      if (!relay.url) {
        throw new ToolMediaInputError("无法恢复可供模型访问的素材 URL", 503);
      }
      if (!relay.objectKey) {
        rebuiltInputs.push({ ...input, modelUrl: relay.url });
        continue;
      }

      createdRelayObjectKeys.push(relay.objectKey);
      const updated = await client.mediaAsset.updateMany({
        where: { id: input.mediaId, status: "ready" },
        data: {
          variants: {
            relay: {
              objectKey: relay.objectKey,
              createdAt: new Date().toISOString(),
            },
          },
        },
      });
      if (updated.count !== 1) {
        throw new ToolMediaInputError("素材状态已变化，请重新提交", 409);
      }
      rebuiltInputs.push({ ...input, modelUrl: relay.url });
    }
    return { inputs: rebuiltInputs, createdRelayObjectKeys };
  } catch (error) {
    if (createdRelayObjectKeys.length) {
      await deleteOssObjects(createdRelayObjectKeys).catch(() => undefined);
    }
    throw error;
  }
}

async function readRows(
  client: Pick<PrismaClient, "$queryRaw">,
  ids: string[],
  lock: boolean,
) {
  if (!ids.length) return [];
  const idList = Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`));
  return client.$queryRaw<ToolMediaRow[]>(Prisma.sql`
    SELECT "id"::text AS "id", "ownerUserId", "kind", "status", "originalName", "declaredMime", "detectedMime", "sizeBytes", "originalKey", "variants", "metadata"
    FROM "MediaAsset"
    WHERE "id" IN (${idList})
    ORDER BY "id"
    ${lock ? Prisma.sql`FOR UPDATE` : Prisma.empty}
  `);
}

export async function inspectToolMediaInputs(input: {
  ownerUserId: number;
  toolMediaIds?: string[];
  toolMediaPositions?: number[];
  modelId?: string;
  client?: ToolMediaClient;
}) {
  const ids = normalizeToolMediaIds(input.toolMediaIds || []);
  const positions = normalizeToolMediaPositions(ids, input.toolMediaPositions);
  if (!ids.length) return [];
  const client = input.client || prisma;
  const rows = await readRows(client, ids, false);
  return validateRows(rows, ids, positions, input.ownerUserId, true, client, input.modelId);
}

export async function createGenerationWithToolMedia<
  TGeneration extends { id: number },
>(input: {
  ownerUserId: number;
  toolMediaIds?: string[];
  toolMediaPositions?: number[];
  modelId?: string;
  /** Platform that will read the media; lets platform-hosted kinds skip the OSS relay. */
  mediaDeliveryTarget?: MediaDeliveryTarget | null;
  role:
    | string
    | ((input: GenerationToolMediaInput, position: number) => string);
  createGeneration: (
    tx: Prisma.TransactionClient,
    inputs: GenerationToolMediaInput[],
  ) => Promise<TGeneration>;
  client?: ToolMediaClient;
}) {
  const ids = normalizeToolMediaIds(input.toolMediaIds || []);
  const positions = normalizeToolMediaPositions(ids, input.toolMediaPositions);
  const client = input.client || prisma;
  const createdRelayObjectKeys: string[] = [];
  // New native file uploads can outlast the transaction timeout. Prepare them
  // before the lock and validate the media again inside the transaction.
  const platform = input.mediaDeliveryTarget?.platform;
  const arkVideo = platform === "volcengine" && getSeedanceMediaPolicy(input.modelId || "")?.allowedKinds.includes("video");
  const prepared = new Map<string, GenerationToolMediaInput>();
  if (ids.length && (platform === "minimax" || arkVideo) && await getMediaDeliveryMode() === "platform") {
    await Promise.all((await inspectToolMediaInputs({ ...input, client })).map(async (media) => {
      if (arkVideo && media.kind !== "video") return;
      if (!isMediaKind(media.kind) || !(await platformHandlesMedia(input.mediaDeliveryTarget, media.kind))) return;
      const modelUrl = await resolveMediaForPlatform(media.localPath, TOOL_MEDIA_RELAY_FOLDER, input.mediaDeliveryTarget, media.kind);
      prepared.set(media.mediaId, { ...media, modelUrl, preparedForPlatform: true });
    }));
  }
  try {
    return await client.$transaction(
      async (tx) => {
      const rows = await readRows(tx, ids, true);
      const validated = await validateRows(
        rows,
        ids,
        positions,
        input.ownerUserId,
        true,
        tx,
        input.modelId,
      );
      const withNativeUrls = validated.map((media) => {
        const item = prepared.get(media.mediaId);
        if (!item) return media;
        if (item.localPath !== media.localPath || item.kind !== media.kind) {
          throw new ToolMediaInputError("素材状态已变化，请重新提交", 409);
        }
        return { ...media, modelUrl: item.modelUrl, preparedForPlatform: true as const };
      });
      const rebuilt = await rebuildMissingToolMediaUrls(tx, withNativeUrls, input.mediaDeliveryTarget);
      const inputs = rebuilt.inputs;
      createdRelayObjectKeys.push(...rebuilt.createdRelayObjectKeys);
      const generation = await input.createGeneration(tx, inputs);
      if (inputs.length) {
        await tx.generationInputMedia.createMany({
          data: inputs.map((media) => ({
            generationId: generation.id,
            mediaId: media.mediaId,
            position: media.position,
            role:
              typeof input.role === "function"
                ? input.role(media, media.position)
                : input.role,
          })),
        });
        await tx.mediaAsset.updateMany({
          where: { id: { in: ids } },
          data: { retentionUntil: null },
        });
      }
      return { generation, inputs };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
        maxWait: 5_000,
        timeout: 15_000,
      },
    );
  } catch (error) {
    if (createdRelayObjectKeys.length) {
      await deleteOssObjects(createdRelayObjectKeys).catch(() => undefined);
    }
    throw error;
  }
}

export async function resolveGenerationInputModelUrls(input: {
  toolMediaInputs: GenerationToolMediaInput[];
  legacyPaths: string[];
  resolveLegacy: (path: string) => Promise<string>;
}) {
  if (input.toolMediaInputs.length) {
    const rebuilt = await rebuildMissingToolMediaUrls(
      prisma,
      input.toolMediaInputs,
    );
    return rebuilt.inputs.map((media) => media.modelUrl);
  }
  return Promise.all(input.legacyPaths.map(input.resolveLegacy));
}

export type PreparedLegacyGenerationInput = {
  manifestPath: string;
  kind: string;
  localPath: string;
  modelUrl: string;
  fileName?: string;
  byteSize?: number;
  probe?: SeedanceMediaProbe;
};

export type ResolvedGenerationInput = {
  position: number;
  source: "tool_media" | "legacy_path";
  kind: string;
  localPath: string;
  modelUrl: string;
  mediaId?: string;
  fileName?: string;
  byteSize?: number;
  probe?: SeedanceMediaProbe;
  preparedForPlatform?: true;
};

function numberArraysEqual(left: number[], right: number[]) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

export async function resolveOrderedGenerationInputs(input: {
  manifest?: GenerationInputManifestV1;
  toolMediaInputs: GenerationToolMediaInput[];
  legacyInputs: PreparedLegacyGenerationInput[];
}): Promise<ResolvedGenerationInput[]> {
  assertGenerationInputManifestMatches(
    input.manifest,
    input.toolMediaInputs.map((media) => media.mediaId),
    input.legacyInputs.map((media) => media.manifestPath),
  );
  if (!input.manifest && input.toolMediaInputs.length && input.legacyInputs.length) {
    throw new ToolMediaInputError(
      "素材来源已混合但缺少顺序信息，请刷新页面后重新提交",
    );
  }
  if (input.manifest) {
    const manifestToolPositions = input.manifest.items.flatMap((item) =>
      item.source === "tool_media" ? [item.position] : [],
    );
    const actualToolPositions = input.toolMediaInputs.map(
      (media) => media.position,
    );
    if (!numberArraysEqual(manifestToolPositions, actualToolPositions)) {
      throw new ToolMediaInputError("素材位置与界面顺序不一致，请重新提交");
    }
  }

  const tools: ResolvedGenerationInput[] = input.toolMediaInputs.map(
    (media) => ({
      position: media.position,
      source: "tool_media",
      kind: media.kind,
      localPath: media.localPath,
      modelUrl: media.modelUrl,
      mediaId: media.mediaId,
      ...(media.fileName ? { fileName: media.fileName } : {}),
      ...(media.byteSize !== undefined ? { byteSize: media.byteSize } : {}),
      ...(media.probe ? { probe: media.probe } : {}),
      ...(media.preparedForPlatform ? { preparedForPlatform: true as const } : {}),
    }),
  );
  const legacy: ResolvedGenerationInput[] = input.legacyInputs.map(
    (media) => ({
      position: -1,
      source: "legacy_path",
      kind: media.kind,
      localPath: media.localPath,
      modelUrl: media.modelUrl,
      ...(media.fileName ? { fileName: media.fileName } : {}),
      ...(media.byteSize !== undefined ? { byteSize: media.byteSize } : {}),
      ...(media.probe ? { probe: media.probe } : {}),
    }),
  );
  const ordered = input.manifest
    ? interleaveGenerationInputValues(input.manifest, tools, legacy)
    : [...tools, ...legacy];

  return ordered.map((media, position) => {
    if (!String(media.modelUrl || "").trim()) {
      throw new ToolMediaInputError(
        `第 ${position + 1} 个素材无法提交给模型，请替换后重试`,
      );
    }
    return { ...media, position };
  });
}

function isMediaKind(kind: string): kind is MediaKind {
  return kind === "image" || kind === "video" || kind === "audio";
}

