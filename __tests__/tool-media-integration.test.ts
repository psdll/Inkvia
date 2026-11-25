vi.mock("@/lib/openrouter-image", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/openrouter-image")>(),
  openRouterGenerateImage: boundary.openRouterGenerateImage,
  readOpenRouterReferenceDimensions: boundary.readOpenRouterReferenceDimensions,
}));
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import sharp from "sharp";

vi.mock("@/lib/runtime-generation-budget", () => ({ reserveRuntimeGeneration: vi.fn(async () => undefined) }));
vi.mock("@/lib/billing/admission", () => ({ assertBillingReady: vi.fn(async () => undefined) }));
vi.mock("@/lib/bailian-qwen-image", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/bailian-qwen-image")>(),
  bailianSubmitQwenImage: boundary.bailianSubmitQwenImage,
}));
vi.mock("@/lib/work-fisher-image", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/work-fisher-image")>(),
  workFisherSubmitImage: boundary.workFisherSubmitImage,
}));

type MediaRow = {
  id: string;
  ownerUserId: number;
  kind: string;
  status: string;
  originalKey: string | null;
  publicUrl: string | null;
  storageProvider: string;
  variants: Record<string, any>;
  metadata: Record<string, any>;
  retentionUntil: Date | null;
  createdAt: Date;
  leaseOwner?: string | null;
};

const boundary = vi.hoisted(() => {
  const state = {
    media: new Map<string, MediaRow>(),
    generations: new Map<number, Record<string, any>>(),
    links: [] as Array<{
      generationId: number;
      mediaId: string;
      position: number;
      role: string;
    }>,
    nextMedia: 1,
    nextGeneration: 1,
    now: new Date("2026-07-24T12:00:00.000Z"),
    sql: [] as string[],
  };
  return {
    state,
    deleteOssObjects: vi.fn(),
    deleteStoredMediaRefs: vi.fn(),
    kieCreateTask: vi.fn(),
    openRouterGenerateImage: vi.fn(),
    readOpenRouterReferenceDimensions: vi.fn(),
    workFisherSubmitImage: vi.fn(),
    bailianSubmitQwenImage: vi.fn(),
    apimartSubmitGptImageVariant: vi.fn(),
    apimartSubmitNanoBanana21: vi.fn(),
    aicomingHaiyaGenerateGptImage25: vi.fn(),
    reapiSubmitGptImage25: vi.fn(),
    saveRemoteFile: vi.fn(),
    googleAiStudioGenerateImage: vi.fn(),
    buildAppPublicUploadUrl: vi.fn(),
    mapImagePathToPublicUrl: vi.fn(),
    loggerGeneration: vi.fn(),
  };
});

const mediaIds = [
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
  "33333333-3333-4333-8333-333333333333",
];
const draftA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const draftB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function sqlText(query: { strings: readonly string[] }) {
  return query.strings.join("?");
}

function linked(mediaId: string) {
  return boundary.state.links.some((link) => link.mediaId === mediaId);
}

function terminalAndExpired(mediaId: string) {
  const generations = boundary.state.links
    .filter((link) => link.mediaId === mediaId)
    .map((link) => boundary.state.generations.get(link.generationId));
  return (
    generations.length > 0 &&
    generations.every(
      (generation) =>
        generation?.finishedAt instanceof Date &&
        ["success", "failed"].includes(generation.status) &&
        generation.finishedAt.getTime() <=
          boundary.state.now.getTime() - 30 * 60_000,
    )
  );
}

function selectedMediaRows(query: { values?: unknown[] }) {
  const ids = (query.values || []).filter((value): value is string =>
    mediaIds.includes(String(value)),
  );
  return [...boundary.state.media.values()]
    .filter((row) => !ids.length || ids.includes(row.id))
    .map((row) => ({ ...row }));
}

const queryRaw = vi.fn(
  async (query: { strings: readonly string[]; values?: unknown[] }) => {
    const text = sqlText(query);
    boundary.state.sql.push(text);
    if (
      text.includes('FROM "MediaAsset"') &&
      !text.includes("WITH candidate")
    ) {
      if (text.includes(`asset."variants"->'relay'`)) {
        const id = (query.values || []).find((value) =>
          mediaIds.includes(String(value)),
        );
        const row = id ? boundary.state.media.get(String(id)) : undefined;
        return row?.leaseOwner && row.variants.relay
          ? [{ id: row.id, objectKey: row.variants.relay.objectKey }]
          : [];
      }
      return selectedMediaRows(query);
    }
    if (
      text.includes("WITH candidate") &&
      text.includes(`asset."variants"->'relay'`)
    ) {
      const claims = [...boundary.state.media.values()]
        .filter(
          (row) =>
            row.variants.relay && linked(row.id) && terminalAndExpired(row.id),
        )
        .map((row) => {
          row.leaseOwner = "relay-worker";
          return { id: row.id, objectKey: row.variants.relay.objectKey };
        });
      return claims;
    }
    if (text.includes("WITH candidate")) {
      const claims = [...boundary.state.media.values()]
        .filter(
          (row) =>
            !linked(row.id) &&
            row.retentionUntil !== null &&
            row.retentionUntil <= boundary.state.now &&
            ["ready", "soft_deleted", "failed", "initiated"].includes(
              row.status,
            ),
        )
        .map((row) => {
          row.status = "purging";
          row.leaseOwner = "gc-worker";
          return { ...row };
        });
      return claims;
    }
    return [];
  },
);

const executeRaw = vi.fn(
  async (query: { strings: readonly string[]; values?: unknown[] }) => {
    const text = sqlText(query);
    boundary.state.sql.push(text);
    const id = (query.values || []).find((value) =>
      mediaIds.includes(String(value)),
    );
    const row = id ? boundary.state.media.get(String(id)) : undefined;
    if (!row) return 0;
    if (text.includes(`"variants" = "variants" - 'relay'`)) {
      delete row.variants.relay;
      row.leaseOwner = null;
      return 1;
    }
    if (text.includes(`SET "status" = 'purged'`)) {
      if (linked(row.id)) return 0;
      row.status = "purged";
      row.originalKey = null;
      row.publicUrl = null;
      row.variants = {};
      row.leaseOwner = null;
      return 1;
    }
    return 1;
  },
);

function matchesScope(row: MediaRow, where: any) {
  if (where.id?.in && !where.id.in.includes(row.id)) return false;
  if (where.ownerUserId !== undefined && row.ownerUserId !== where.ownerUserId)
    return false;
  if (where.status !== undefined && row.status !== where.status) return false;
  for (const clause of where.AND || []) {
    const path = clause.metadata?.path?.[0];
    if (path && row.metadata[path] !== clause.metadata.equals) return false;
  }
  if (where.generationInputs?.none && linked(row.id)) return false;
  return true;
}

const mediaAsset = {
  create: vi.fn(async ({ data }: any) => {
    const id = mediaIds[boundary.state.nextMedia - 1];
    boundary.state.nextMedia += 1;
    boundary.state.media.set(id, {
      id,
      ...data,
      createdAt: boundary.state.now,
    });
    return { id, status: data.status };
  }),
  findMany: vi.fn(async ({ where }: any) =>
    [...boundary.state.media.values()]
      .filter((row) => matchesScope(row, where))
      .map((row) => ({
        ...row,
        _count: {
          generationInputs: boundary.state.links.filter(
            (link) => link.mediaId === row.id,
          ).length,
        },
      })),
  ),
  updateMany: vi.fn(async ({ where, data }: any) => {
    const rows = [...boundary.state.media.values()].filter((row) =>
      matchesScope(row, where),
    );
    rows.forEach((row) => Object.assign(row, data));
    return { count: rows.length };
  }),
};

const generation = {
  create: vi.fn(async ({ data }: any) => {
    const row = { id: boundary.state.nextGeneration++, ...data };
    boundary.state.generations.set(row.id, row);
    return row;
  }),
  update: vi.fn(async ({ where, data }: any) => {
    const row = boundary.state.generations.get(where.id)!;
    Object.assign(row, data);
    return row;
  }),
};

const tx = {
  $queryRaw: queryRaw,
  $executeRaw: executeRaw,
  generation,
  generationInputMedia: {
    createMany: vi.fn(async ({ data }: any) => {
      boundary.state.links.push(...data);
      return { count: data.length };
    }),
  },
  mediaAsset,
};

const prisma = {
  $queryRaw: queryRaw,
  $executeRaw: executeRaw,
  $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) =>
    callback(tx),
  ),
  mediaAsset,
  generation,
};

vi.doMock("@/lib/prisma", () => ({ default: prisma, prisma }));
vi.mock("@/lib/upload-limits", () => ({ assertUploadDiskWatermark: vi.fn() }));
vi.mock("@/lib/storage", () => ({
  saveBufferFile: vi.fn(
    async (_buffer: Buffer, folder: string) =>
      `/uploads/${folder}/source-${boundary.state.nextMedia}.png`,
  ),
  saveRemoteFile: boundary.saveRemoteFile,
}));
vi.mock("@/lib/external-assets", () => ({
  resolveLocalUploadPathForExternalApiWithRelay: vi.fn(
    async (path: string) => ({
      url: `https://oss.example.com${path}?signature=temporary`,
      objectKey: `uploads/tool-input-relay/${path.split("/").at(-1)}`,
    }),
  ),
  buildAppPublicUploadUrl: vi.fn(boundary.buildAppPublicUploadUrl),
}));
vi.mock("@/lib/oss", () => ({
  deleteOssObjects: boundary.deleteOssObjects,
  isOssPublicUrlConfigured: vi.fn(() => true),
  resolveOssObjectUrlForExternalApi: vi.fn(),
  buildOssObjectPublicUrl: vi.fn(
    (key: string) => `https://oss.example.com/${key}`,
  ),
}));
vi.mock("@/lib/media-cleanup", () => ({
  collectMediaRefs: (value: unknown, refs: Set<string>) => {
    if (typeof value === "string" && value.startsWith("/uploads/"))
      refs.add(value);
  },
  deleteStoredMediaRefs: boundary.deleteStoredMediaRefs,
}));
vi.mock("fs-extra", () => ({ default: { remove: vi.fn() } }));
vi.mock("@/lib/kie", () => ({ kieCreateTask: boundary.kieCreateTask }));
vi.mock("@/lib/kie-image-lite", () => ({
  NANO_BANANA_2_LITE_MODEL: "nano-banana-2-lite",
  buildNanoBanana2LiteKieInput: vi.fn(),
}));
vi.mock("@/lib/logger", () => ({
  Logger: { api: vi.fn(), generation: boundary.loggerGeneration },
}));
vi.mock("@/lib/config", () => ({
  getKieImageEditModel: () => "google/nano-banana-edit",
  getApimartImageModel: () => "unused",
}));
vi.mock("@/lib/volcengine", () => ({ volcSeedreamGenerate: vi.fn() }));
vi.mock("@/lib/generation/agent-output-recovery", () => ({captureGenerationImageOutputs: vi.fn(async()=>"private-test-key")}));
vi.mock("@/lib/volcengine-seedream-55-input", () => ({validateVolcSeedream55Reference: vi.fn(async()=>undefined)}));
vi.mock("@/lib/generation/finalize", () => ({ finalizeGeneration: vi.fn() }));
vi.mock("@/lib/generation/output-folder", () => ({
  generationOutputFolder: () => "image_edit",
}));
vi.mock("@/lib/google-ai-studio-image", () => ({
  googleAiStudioGenerateImage: boundary.googleAiStudioGenerateImage,
  isGoogleAiStudioImageModel: (model: string) => model === 'gemini-3-pro-image',
}));
vi.mock("@/lib/reapi-image", () => ({ REAPI_GPT_IMAGE_2_MODEL_ID: "gpt-image-2-official-reapi", reapiSubmitImage: vi.fn(), reapiSubmitGptImage25: boundary.reapiSubmitGptImage25 }));
vi.mock("@/lib/aicoming-image", () => ({ aicomingHaiyaSubmitImage: vi.fn(), aicomingHaiyaSubmitNanoBananaPro: vi.fn(), aicomingHaiyaGenerateGptImage25: boundary.aicomingHaiyaGenerateGptImage25 }));
vi.mock("@/lib/apimart-image", () => ({
  apimartSubmitImage: vi.fn(),
  apimartSubmitNanoBanana21: boundary.apimartSubmitNanoBanana21,
  apimartSubmitGptImageVariant: boundary.apimartSubmitGptImageVariant,
  apimartSubmitNanoBananaPro: vi.fn(),
  isApimartImageModel: (model: string) => ["gpt-image-2.5-apimart", "gpt-image-2.6-apimart", "gemini-nano-banana-2.1-apimart"].includes(model),
  isApimartNanoBananaProModel: () => false,
}));
vi.mock("@/lib/jiekou-image", () => ({
  JIEKOU_GPT_IMAGE_2_EDIT_MODEL: "unused",
  JIEKOU_GPT_IMAGE_2_MODEL_ID: "unused",
  JIEKOU_GPT_IMAGE_2_TEXT_MODEL: "unused",
  jiekouGptImage2Generate: vi.fn(),
  mapJiekouGptImage2Size: vi.fn(),
}));
vi.mock("@/lib/image-edit-models", () => ({
  DOUBAO_SEEDREAM_5_LITE_MODEL: "unused",
  DOUBAO_SEEDREAM_5_PRO_MODEL: "unused",
  GOOGLE_AI_STUDIO_FLASH_LITE_IMAGE_MODEL: "unused",
  IMAGE_EDIT_MODEL_DEFINITIONS: [{ id: "doubao-seedream-5.5" }, { id: "gemini-3-pro-image-openrouter" }, { id: "nano-banana-2-1" }, { id: "gemini-nano-banana-2.1-apimart" }, { id: "gemini-nano-banana-2.1-openrouter" },{ id: "gpt-image-2-openrouter" }, { id: "gpt-image-2.5-sunburst-openrouter" },{ id: 'gemini-3-pro-image' }, { id: "google/nano-banana-edit" }, { id: "nano-banana-pro" }, { id: "gpt-image-2.5-apimart" }, { id: "gpt-image-2.6-apimart" }, { id: "gpt-image-2.5-aicoming-haiya" }, { id: "gpt-image-2.5-reapi" }, { id: "qwen-image-global-2.1" }, { id: "qwen-image-3.0" }],
  isImageEditModelVisible: vi.fn(async () => true),
}));
vi.mock("@/lib/error-friendly", () => ({
  toFriendlyError: (message: string) => ({ message }),
  formatFriendlyMessageForStorage: (value: { message: string }) =>
    value.message,
  unknownFriendlyErrorLogMeta: () => null,
}));
vi.mock("@/lib/billing-ledger", () => ({
  upsertUsageLedgerForGenerationId: vi.fn(async () => undefined),
}));
vi.mock("@/lib/admin-asset-feed", () => ({
  upsertAdminAssetFeedForGenerationId: vi.fn(async () => undefined),
}));
vi.mock("@/lib/generation/input-snapshot", () => ({
  snapshotLibraryInputs: vi.fn(async (paths) => paths),
}));
vi.mock("@/lib/maintenance", () => ({
  runGenerationCompletionCreate: vi.fn(),
}));
vi.mock("@/lib/image-edit-helpers", () => ({
  mapSeedreamSize: vi.fn(),
  mapSeedreamModelId: vi.fn(),
  buildSeedreamPrompt: (prompt: string) => prompt,
  dedupeImageUrlsByContent: (values: string[]) => values,
  mapImagePathToPublicUrl: boundary.mapImagePathToPublicUrl,
}));
vi.mock("@/lib/providers/model-availability", () => ({
  isProviderModelEnabled: () => true,
}));
vi.mock("@/lib/providers/registry", () => ({
  getRegisteredProviders: vi.fn(async () => []),
}));
vi.mock("@/lib/canvas/observability", () => ({
  canvasMetrics: { increment: vi.fn() },
}));

let createImageGeneration: typeof import("@/lib/generation/image-service").createImageGeneration;
let runCanvasMediaGcBatch: typeof import("@/lib/canvas/media-gc").runCanvasMediaGcBatch;
let runToolMediaRelayMaintenanceBatch: typeof import("@/lib/tool-media/maintenance").runToolMediaRelayMaintenanceBatch;
let listToolMediaDrafts: typeof import("@/lib/tool-media/service").listToolMediaDrafts;
let releaseToolMedia: typeof import("@/lib/tool-media/service").releaseToolMedia;
let uploadToolMedia: typeof import("@/lib/tool-media/service").uploadToolMedia;

beforeAll(async () => {
  ({ createImageGeneration } = await import("@/lib/generation/image-service"));
  ({ runCanvasMediaGcBatch } = await import("@/lib/canvas/media-gc"));
  ({ runToolMediaRelayMaintenanceBatch } =
    await import("@/lib/tool-media/maintenance"));
  ({ listToolMediaDrafts, releaseToolMedia, uploadToolMedia } =
    await import("@/lib/tool-media/service"));
});

function pngFile() {
  return new File(
    [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1])],
    "input.png",
    { type: "image/png" },
  );
}

async function upload(ownerUserId = 7, draftSessionId = draftA) {
  return uploadToolMedia({ ownerUserId, draftSessionId, file: pngFile() });
}

async function failImageTask(mediaId: string) {
  const generationId = boundary.state.nextGeneration;
  const callsBefore = boundary.kieCreateTask.mock.calls.length;
  boundary.kieCreateTask.mockRejectedValue(new Error("provider rejected"));
  await expect(
    createImageGeneration({
      authUserId: 7,
      prompt: "test",
      model: "google/nano-banana-edit",
      toolMediaIds: [mediaId],
    }),
  ).rejects.toMatchObject({ generationId });
  expect(boundary.kieCreateTask).toHaveBeenCalledTimes(callsBefore + 1);
}

describe("tool media integration", () => {
  beforeEach(() => {
    boundary.state.media.clear();
    boundary.state.generations.clear();
    boundary.state.links.length = 0;
    boundary.state.nextMedia = 1;
    boundary.state.nextGeneration = 1;
    boundary.state.now = new Date("2026-07-24T12:00:00.000Z");
    boundary.state.sql.length = 0;
    vi.useFakeTimers();
    vi.setSystemTime(boundary.state.now);
    vi.clearAllMocks();
    boundary.buildAppPublicUploadUrl.mockImplementation(
      (path: string) => `https://app.example.com${path}`,
    );
    boundary.mapImagePathToPublicUrl.mockImplementation(
      (path: string) => Promise.resolve(`https://model.example.com${path}`),
    );
    boundary.deleteOssObjects.mockResolvedValue({ deleted: 1 });
    boundary.deleteStoredMediaRefs.mockResolvedValue({
      ossError: null,
      failedOssKeys: [],
      skippedProtectedRefsCount: 0,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([false,true])("routes official Seedream 5.5 and durably captures all outputs (layers=%s)", async layers => {
    const {volcSeedreamGenerate}=await import("@/lib/volcengine");
    const {captureGenerationImageOutputs}=await import("@/lib/generation/agent-output-recovery");
    const {finalizeGeneration}=await import("@/lib/generation/finalize");
    vi.mocked(finalizeGeneration).mockResolvedValue("done");
    const urls=layers?["https://result.test/a.png","https://result.test/a.png"]:["https://result.test/a.png"];
    vi.mocked(volcSeedreamGenerate).mockResolvedValue({urls,modelUsed:"doubao-seedream-5-5-261028",raw:{data:urls.map((url,z_index)=>({url,z_index,text_recognition:{text:"HELLO"}})),usage:{output_images:urls.length}}});
    const reference=layers?await upload():null;
    const result=await createImageGeneration({authUserId:7,prompt:layers?"":"cat",model:"doubao-seedream-5.5",resolution:"1.5K",background:"transparent",toolMediaIds:reference?[reference.mediaId]:[],seedream55:layers?{layerDecomposition:true,textRecognition:true,layerMaxImages:3}:undefined});
    await vi.waitFor(()=>expect(captureGenerationImageOutputs).toHaveBeenCalledWith(result.generationId,urls));
    await vi.waitFor(()=>expect(finalizeGeneration).toHaveBeenCalledWith(result.generationId));
    const body=vi.mocked(volcSeedreamGenerate).mock.calls[0][0];
    expect(vi.mocked(volcSeedreamGenerate).mock.calls[0][1]).toEqual({exactModel:true});
    expect(body).toMatchObject({model:"doubao-seedream-5-5-261028",size:"1.5K"});
    for(const field of ["n","resolution","image_urls","quality","stream","tools","sequential_image_generation"]) expect(body).not.toHaveProperty(field);
    const saved=boundary.state.generations.get(result.generationId)!;
    expect(saved.externalProvider).toBe("volcengine");
    const metadata=JSON.parse(saved.templateData);
    expect(metadata.seedream55Outputs).toHaveLength(urls.length);
    expect(metadata.imageInputCount).toBe(layers?1:0);
    if(layers){ expect(body).not.toHaveProperty("background");expect(body).not.toHaveProperty("prompt"); }
  });

  it("uses the first manifest reference for OpenRouter adaptive pixels and persists the submitted size", async () => {
    const ready = await upload();
    boundary.readOpenRouterReferenceDimensions.mockResolvedValue({ width: 1086, height: 1448 });
    boundary.openRouterGenerateImage.mockResolvedValue({ images: ["data:image/png;base64,YQ=="], usage: { cost: 0.1 } });
    boundary.saveRemoteFile.mockResolvedValue("/uploads/generated/openrouter.png");
    const result = await createImageGeneration({
      authUserId: 7, prompt: "edit", model: "gpt-image-2-openrouter", aspectRatio: "auto", resolution: "2K",
      toolMediaIds: [ready.mediaId], imagePaths: ["/uploads/product-library/first.png"],
      inputManifest: { version: 1, items: [
        { position: 0, source: "legacy_path", path: "/uploads/product-library/first.png" },
        { position: 1, source: "tool_media", mediaId: ready.mediaId },
      ] },
    });
    await vi.waitFor(() => expect(boundary.state.generations.get(result.generationId)?.status).toBe("success"));
    expect(boundary.readOpenRouterReferenceDimensions).toHaveBeenCalledTimes(1);
    expect(boundary.readOpenRouterReferenceDimensions).toHaveBeenCalledWith("/uploads/product-library/first.png");
    expect(boundary.openRouterGenerateImage).toHaveBeenCalledWith(expect.objectContaining({ firstReferenceDimensions: { width: 1086, height: 1448 }, aspectRatio: "auto", resolution: "2K" }));
    const meta = JSON.parse(boundary.state.generations.get(result.generationId)!.templateData);
    expect(meta).toMatchObject({ aspectRatio: "auto", resolution: "2K" });
    expect(meta.openrouter.request.size).toBe("1760x2352");
    expect(meta.openrouter.request).not.toHaveProperty("resolution");
    expect(meta.openrouter.request).not.toHaveProperty("aspect_ratio");
  });

  it.each([false, true])("persists OpenRouter request and usage before storage; storage failure=%s", async (failStorage) => {
    const ready = await upload();
    boundary.openRouterGenerateImage.mockResolvedValue({ images: ["data:image/webp;base64,YQ=="], usage: { cost: 0.13 } });
    boundary.saveRemoteFile.mockImplementationOnce(async () => {
      const row = [...boundary.state.generations.values()][0];
      expect(JSON.parse(row.templateData).providerUsage).toEqual({ usage: { cost: 0.13 } });
      if (failStorage) throw new Error("storage failed");
      return "/uploads/generated/openrouter.webp";
    });
    const result = await createImageGeneration({ authUserId: 7, prompt: "edit", model: "gpt-image-2.5-sunburst-openrouter", quality: "max", aspectRatio: "16:9", resolution: "4K", background: "transparent", toolMediaIds: [ready.mediaId] });
    await vi.waitFor(() => expect(boundary.state.generations.get(result.generationId)?.status).toBe(failStorage ? "failed" : "success"));
    const row = boundary.state.generations.get(result.generationId)!;
    const meta = JSON.parse(row.templateData);
    expect(row.externalProvider).toBe("openrouter");
    expect(meta.openrouter.request).toMatchObject({ model: "openai/gpt-image-2.5-sunburst", quality: "max", background: "transparent", output_format: "png", n: 1 });
    expect(meta).toMatchObject({ aspectRatio: "16:9", resolution: "4K", background: "transparent", outputFormat: "png" });
    expect(meta.openrouter.request.size).toBe("3840x2160");
    expect(meta.openrouter.request.input_references).toHaveLength(1);
    expect(meta.providerUsage.usage.cost).toBe(0.13);
    expect(row.localPath).toBe(failStorage ? null : "/uploads/generated/openrouter.webp");
    expect(boundary.openRouterGenerateImage).toHaveBeenCalledTimes(1);
    expect(boundary.kieCreateTask).not.toHaveBeenCalled();
  });

  it.each([false, true])("validates Pro output pixels after retaining usage and preserves a downgraded paid image; valid=%s", async valid => {
    const ready = await upload();
    const width = valid ? 1792 : 896, height = valid ? 2400 : 1200;
    const bytes = await sharp({ create: { width, height, channels: 3, background: "#999" } }).png().toBuffer();
    boundary.openRouterGenerateImage.mockResolvedValue({ images: [`data:image/png;base64,${bytes.toString("base64")}`], usage: { cost: 0.135 } });
    boundary.saveRemoteFile.mockImplementationOnce(async () => {
      const row = [...boundary.state.generations.values()][0];
      expect(JSON.parse(row.templateData).providerUsage.usage.cost).toBe(0.135);
      return "/uploads/generated/pro-original.png";
    });
    const result = await createImageGeneration({ authUserId: 7, prompt: "chair", model: "gemini-3-pro-image-openrouter", aspectRatio: "3:4", resolution: "2K", toolMediaIds: [ready.mediaId] });
    await vi.waitFor(() => expect(boundary.state.generations.get(result.generationId)?.status).toBe(valid ? "success" : "failed"));
    const row = boundary.state.generations.get(result.generationId)!;
    expect(row.localPath).toBe("/uploads/generated/pro-original.png");
    const meta = JSON.parse(row.templateData);
    expect(meta.providerUsage.usage.cost).toBe(0.135);
    expect(meta.openrouter.request.provider).toEqual({ only: ["google-ai-studio/global"], allow_fallbacks: false });
    if (valid) expect(meta.openrouter.outputDimensions).toEqual([{ width, height }]);
    else expect(row.errorMsg).toContain("896×1200");
    expect(boundary.openRouterGenerateImage).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])('keeps Google usage before image storage, storage failure=%s', async (failStorage) => {
    const usageMetadata = { promptTokenCount: 3, candidatesTokenCount: 1229, thoughtsTokenCount: 179,
      candidatesTokensDetails: [{ modality: 'IMAGE', tokenCount: 1120 }] };
    boundary.googleAiStudioGenerateImage.mockResolvedValue({ images: ['https://google.test/image.png'], raw: { usageMetadata } });
    boundary.saveRemoteFile.mockImplementationOnce(async () => {
      const row = [...boundary.state.generations.values()][0];
      expect(JSON.parse(row.templateData).providerUsage).toEqual({ usageMetadata });
      expect(row.status).toBe('running');
      if (failStorage) throw new Error('storage unavailable');
      return '/uploads/image_edit/google.png';
    });
    const result = await createImageGeneration({ authUserId: 7, source: 'canvas', prompt: 'test', model: 'gemini-3-pro-image', resolution: '2K' });
    await vi.waitFor(() => expect(boundary.state.generations.get(result.generationId)?.status).toBe(failStorage ? 'failed' : 'success'));
    const row = boundary.state.generations.get(result.generationId)!;
    expect(JSON.parse(row.templateData).providerUsage).toEqual({ usageMetadata });
    expect(JSON.parse(row.templateData).usageCapture.providerCompleted).toBe(true);
    expect(boundary.googleAiStudioGenerateImage).toHaveBeenCalledTimes(1);
  });

  it.each(["tool", "canvas", "agent", "batch"].flatMap(source => ["standard", "pro"].map(quality => ({ source, quality }))))("submits Qwen 3 $quality from $source with ordered refs and durable identity", async ({source, quality}) => {
    const first = await upload();
    const second = await upload();
    boundary.bailianSubmitQwenImage.mockResolvedValue({ taskId: "qwen3-task" });
    const result = await createImageGeneration({ authUserId: 7, source: source as any, prompt: "edit", model: "qwen-image-3.0", quality, aspectRatio: "9:16", resolution: "2K", toolMediaIds: [second.mediaId, first.mediaId] });
    expect(result).toMatchObject({ taskId: "qwen3-task", status: "running" });
    const row = boundary.state.generations.get(result.generationId)!;
    expect(row).toMatchObject({ model: "qwen-image-3.0", externalProvider: "bailian", externalTaskId: "qwen3-task" });
    const meta = JSON.parse(row.templateData);
    expect(meta).toMatchObject({ quality, providerModel: quality === "pro" ? "qwen-image-3.0-pro" : "qwen-image-3.0", outputCount: 1, phase: "generating", bailianQwenImage: { request: { parameters: { n: 1, size: "1152*2048" } } } });
    expect(meta.bailianQwenImage.request.input.messages[0].content).toEqual([
      { image: "https://oss.example.com/uploads/tool-input-relay/source-2.png" },
      { image: "https://oss.example.com/uploads/tool-input-relay/source-1.png" },
      { text: expect.any(String) },
    ]);
    expect(boundary.kieCreateTask).not.toHaveBeenCalled();
  });

  it.each(["tool", "canvas", "agent", "batch"])("submits FisherAI from %s with public references and durable task identity", async (source) => {
    const first = await upload();
    const second = await upload();
    boundary.workFisherSubmitImage.mockResolvedValue({ taskId: "fisher-task", raw: {} });
    const result = await createImageGeneration({ authUserId: 7, source: source as any, prompt: "edit", model: "qwen-image-global-2.1", toolMediaIds: [second.mediaId, first.mediaId] });
    expect(result).toMatchObject({ taskId: "fisher-task", status: "running" });
    const row = boundary.state.generations.get(result.generationId)!;
    expect(row).toMatchObject({ externalProvider: "work-fisher", externalTaskId: "fisher-task" });
    const meta = JSON.parse(row.templateData);
    expect(meta).toMatchObject({ aspectRatio: "3:4", resolution: "2K", phase: "generating", workFisher: { request: { model: "qwen-image-global-2.1", metadata: { ratio: "3:4", resolution: "2k" } } } });
    expect(meta.workFisher.request.images).toEqual(boundary.workFisherSubmitImage.mock.calls[0][0].imageUrls);
    expect(meta.workFisher.request.images).toEqual(["https://oss.example.com/uploads/tool-input-relay/source-2.png", "https://oss.example.com/uploads/tool-input-relay/source-1.png"]);
    expect(boundary.kieCreateTask).not.toHaveBeenCalled();
  });

  it.each(["flare", "sunburst"])("routes reAPI 2.5 %s and records its task, quality and ordered references", async (mode) => {
    const first = await upload();
    const second = await upload();
    const { buildReapiGptImage25Request } = await import("@/lib/reapi-gpt-image-25");
    boundary.reapiSubmitGptImage25.mockImplementation(async (input) => ({ taskId: "task_re25", request: buildReapiGptImage25Request(input).body, raw: {} }));
    const result = await createImageGeneration({ authUserId: 7, prompt: "edit", model: "gpt-image-2.5-reapi", background: "transparent", outputFormat: "webp", gptImage25Mode: mode, quality: "max", aspectRatio: "9:16", resolution: "4K", toolMediaIds: [first.mediaId, second.mediaId], n: 4 });
    expect(result).toMatchObject({ taskId: "task_re25", status: "running" });
    expect(boundary.kieCreateTask).not.toHaveBeenCalled();
    expect(boundary.apimartSubmitGptImageVariant).not.toHaveBeenCalled();
    expect(boundary.aicomingHaiyaGenerateGptImage25).not.toHaveBeenCalled();
    const row = boundary.state.generations.get(result.generationId)!;
    expect(row).toMatchObject({ externalProvider: "reapi", externalTaskId: "task_re25" });
    const snapshot = JSON.parse(row.templateData);
    expect(snapshot).toMatchObject({ providerModel: `gpt-image-2.5-${mode}-official`, gptImage25Mode: mode, quality: "max", outputCount: 1, reapiGptImage25: { taskId: "task_re25", request: { model: `gpt-image-2.5-${mode}-official`, size: "2160x3840", quality: "max", n: 1 } } });
    expect(snapshot).toMatchObject({ background: "transparent", outputFormat: "png", reapiGptImage25: { request: { background: "transparent", output_format: "png" } } });
    expect(snapshot.reapiGptImage25.request.image_urls).toEqual(["https://oss.example.com/uploads/tool-input-relay/source-1.png", "https://oss.example.com/uploads/tool-input-relay/source-2.png"]);
    expect(snapshot.reapiGptImage25.request).not.toHaveProperty("async");
    expect(snapshot.reapiGptImage25.request).not.toHaveProperty("resolution");
  });

  it.each(["gpt-image-2.5-apimart", "gpt-image-2.5-reapi"])("rejects invalid background before submitting %s or recording a generation", async (model) => {
    await expect(createImageGeneration({ authUserId: 7, prompt: "chair", model, background: "invalid" })).rejects.toThrow("背景");
    expect(boundary.apimartSubmitGptImageVariant).not.toHaveBeenCalled();
    expect(boundary.reapiSubmitGptImage25).not.toHaveBeenCalled();
    expect(boundary.state.generations.size).toBe(0);
  });

  it("persists the reAPI request before a submission failure", async () => {
    const first = await upload();
    boundary.reapiSubmitGptImage25.mockRejectedValueOnce(new Error("provider rejected"));
    await expect(createImageGeneration({ authUserId: 7, prompt: "edit", model: "gpt-image-2.5-reapi", toolMediaIds: [first.mediaId] })).rejects.toThrow();
    const row = boundary.state.generations.get(1)!;
    expect(row.status).toBe("failed");
    expect(JSON.parse(row.templateData).reapiGptImage25.request.image_urls).toEqual(["https://oss.example.com/uploads/tool-input-relay/source-1.png"]);
  });

  it.each(["nano-banana-2-1", "gemini-nano-banana-2.1-apimart"])("persists Nano Banana 2.1 %s identity and ordered references", async model => {
    const first = await upload();
    const second = await upload();
    const { buildApimartNanoBanana21Request } = await import("@/lib/nano-banana-21-providers");
    boundary.kieCreateTask.mockResolvedValue({ taskId: "nano21-kie-task" });
    boundary.apimartSubmitNanoBanana21.mockImplementation(async input => ({ taskId: "nano21-task", request: buildApimartNanoBanana21Request(input), raw: {} }));
    const result = await createImageGeneration({ authUserId: 7, prompt: "edit", model, aspectRatio: "1:8", resolution: "4K", toolMediaIds: [first.mediaId, second.mediaId], n: 4 });
    const row = boundary.state.generations.get(result.generationId)!;
    const snapshot = JSON.parse(row.templateData);
    expect(row.externalProvider).toBe(model === "nano-banana-2-1" ? "kie" : "apimart");
    expect(row.externalTaskId).toBeTruthy();
    expect(snapshot.outputCount).toBe(1);
    const request = model === "nano-banana-2-1" ? snapshot.kie.request : snapshot.apimart.request;
    expect(request.model).toBe(model === "nano-banana-2-1" ? model : "gemini-nano-banana-2.1");
    expect(model === "nano-banana-2-1" ? request.input.image_input : request.image_urls).toEqual([
      "https://oss.example.com/uploads/tool-input-relay/source-1.png",
      "https://oss.example.com/uploads/tool-input-relay/source-2.png",
    ]);
    expect(model === "nano-banana-2-1" ? request.input.resolution : request.resolution).toBe("4K");
  });

  it.each([["2.5", "flare"], ["2.5", "sunburst"], ["2.6", "flare"], ["2.6", "sunburst"]])("routes GPT Image %s %s and persists the chosen mode and max quality", async (version, mode) => {
    const ready = await upload();
    const model = `gpt-image-${version}-apimart`;
    const providerModel = `gpt-image-${version}-${mode}`;
    const { buildApimartGptImageVariantRequest } = await import("@/lib/apimart-gpt-image-25");
    boundary.apimartSubmitGptImageVariant.mockImplementation(async (input) => ({ taskId: "apimart-task", request: buildApimartGptImageVariantRequest(input), raw: {} }));
    const result = await createImageGeneration({ authUserId: 7, prompt: "edit", model, background: "transparent", outputFormat: "webp", gptImage25Mode: mode, quality: "max", aspectRatio: "auto", resolution: "4K", toolMediaIds: [ready.mediaId], n: 4 });
    expect(result).toMatchObject({ taskId: "apimart-task", status: "running" });
    expect(boundary.kieCreateTask).not.toHaveBeenCalled();
    const row = boundary.state.generations.get(result.generationId)!;
    expect(row).toMatchObject({ externalProvider: "apimart", externalTaskId: "apimart-task" });
    const snapshot = JSON.parse(row.templateData);
    expect(snapshot).toMatchObject({ model, providerModel, gptImage25Mode: mode, quality: "max", outputCount: 1, apimart: { mode, taskId: "apimart-task", request: { model: providerModel, quality: "max", resolution: "4k", n: 1 } } });
    expect(snapshot).toMatchObject({ background: "transparent", outputFormat: "png", apimart: { request: { background: "transparent", output_format: "png" } } });
    expect(snapshot.apimart.request.image_urls).toHaveLength(1);
    expect(snapshot.apimart.request).not.toHaveProperty("size");
    expect(snapshot.apimart.request).not.toHaveProperty("mask_url");
  });

  it.each([["flare", "xhigh"], ["flare", "max"], ["sunburst", "xhigh"], ["sunburst", "max"]])("runs Haiya %s with %s in the background and saves the image before success", async (mode, quality) => {
    const ready = await upload();
    let complete!: (value: any) => void;
    let finishSave!: (value: string) => void;
    boundary.aicomingHaiyaGenerateGptImage25.mockReturnValueOnce(new Promise((resolve) => { complete = resolve; }));
    boundary.saveRemoteFile.mockReturnValueOnce(new Promise((resolve) => { finishSave = resolve; }));
    const result = await createImageGeneration({ authUserId: 7, prompt: "edit", model: "gpt-image-2.5-aicoming-haiya", gptImage25Mode: mode, quality, background: "transparent", outputFormat: "webp", aspectRatio: "9:16", resolution: "4K", toolMediaIds: [ready.mediaId], n: 4 });
    expect(result).toMatchObject({ taskId: String(result.generationId), status: "running" });
    expect(boundary.kieCreateTask).not.toHaveBeenCalled();
    expect(boundary.apimartSubmitGptImageVariant).not.toHaveBeenCalled();
    expect(boundary.aicomingHaiyaGenerateGptImage25).toHaveBeenCalledWith(expect.objectContaining({ requestKey: expect.stringContaining("generation-"), background: "transparent", outputFormat: "png" }));
    const row = boundary.state.generations.get(result.generationId)!;
    expect(row).toMatchObject({ status: "running", externalProvider: "aicoming-haiya", externalTaskId: null });
    const snapshot = JSON.parse(row.templateData);
    expect(snapshot).toMatchObject({ providerModel: `gpt-image-2.5-${mode}`, gptImage25Mode: mode, quality, outputCount: 1, background: "transparent", outputFormat: "png", aicomingGptImage25: { transport: "sync", request: { model: `gpt-image-2.5-${mode}`, size: "2160x3840", quality, background: "transparent", output_format: "png", n: 1 } } });
    expect(snapshot.aicomingGptImage25.request.image).toHaveLength(1);
    expect(snapshot.aicomingGptImage25.request).not.toHaveProperty("async");
    expect(snapshot.aicomingGptImage25.request).not.toHaveProperty("image_urls");
    expect(snapshot.aicomingGptImage25.request).not.toHaveProperty("resolution");
    complete({ images: ["https://cdn.test/result.png"] });
    await vi.waitFor(() => expect(boundary.saveRemoteFile).toHaveBeenCalledWith("https://cdn.test/result.png", expect.any(String), false, { providerId: "aicoming-haiya" }));
    expect(boundary.state.generations.get(result.generationId)!.status).toBe("running");
    finishSave("/uploads/generated/haiya.png");
    await vi.waitFor(() => expect(boundary.state.generations.get(result.generationId)).toMatchObject({ status: "success", localPath: "/uploads/generated/haiya.png", externalTaskId: null }));
    expect(boundary.aicomingHaiyaGenerateGptImage25).toHaveBeenCalledTimes(1);
  });

  it.each(["provider", "storage"])("records a Haiya synchronous %s failure without resubmitting", async (failure) => {
    const ready = await upload();
    if (failure === "provider") boundary.aicomingHaiyaGenerateGptImage25.mockRejectedValueOnce(new Error("sync request failed"));
    else {
      boundary.aicomingHaiyaGenerateGptImage25.mockResolvedValueOnce({ images: ["data:image/png;base64,aW1hZ2U="] });
      boundary.saveRemoteFile.mockRejectedValueOnce(new Error("storage failed"));
    }
    const result = await createImageGeneration({ authUserId: 7, prompt: "edit", model: "gpt-image-2.5-aicoming-haiya", toolMediaIds: [ready.mediaId] });
    await vi.waitFor(() => expect(boundary.state.generations.get(result.generationId)).toMatchObject({ status: "failed", localPath: null, externalTaskId: null }));
    const snapshot = JSON.parse(boundary.state.generations.get(result.generationId)!.templateData);
    expect(snapshot.aicomingGptImage25.request.image).toHaveLength(1);
    expect(snapshot.aicomingGptImage25.request).not.toHaveProperty("async");
    expect(boundary.aicomingHaiyaGenerateGptImage25).toHaveBeenCalledTimes(1);
    if (failure === "storage") expect(boundary.saveRemoteFile).toHaveBeenCalledWith("data:image/png;base64,aW1hZ2U=", expect.any(String), true, { providerId: "aicoming-haiya" });
  });

  it("keeps the local source and GenerationInputMedia after a real image task submission fails", async () => {
    const ready = await upload();
    await failImageTask(ready.mediaId);

    const asset = boundary.state.media.get(ready.mediaId)!;
    expect(ready).toMatchObject({
      status: "ready",
      modelUrl: expect.stringContaining("signature=temporary"),
    });
    expect(asset.originalKey).toBe("/uploads/imports/source-1.png");
    expect(asset.variants.relay).toEqual({
      objectKey: "uploads/tool-input-relay/source-1.png",
      createdAt: expect.any(String),
    });
    expect(
      JSON.stringify(asset, (_key, value) =>
        typeof value === "bigint" ? value.toString() : value,
      ),
    ).not.toContain("signature=temporary");
    expect(boundary.state.generations.get(1)).toMatchObject({
      status: "failed",
      finishedAt: expect.any(Date),
    });
    expect(boundary.state.links).toEqual([
      {
        generationId: 1,
        mediaId: ready.mediaId,
        position: 0,
        role: "reference_image",
      },
    ]);
    expect(asset.retentionUntil).toBeNull();
    expect(boundary.state.sql.some((sql) => sql.includes("FOR UPDATE"))).toBe(
      true,
    );
  });

  it("does not persist a signed tool-media URL in image task log metadata", async () => {
    const ready = await upload();
    await failImageTask(ready.mediaId);

    const taskCreate = boundary.loggerGeneration.mock.calls.find(
      ([action]) => action === "task_create",
    );
    const metadata = taskCreate?.[4];
    expect(metadata).toMatchObject({
      toolMediaCount: 1,
      toolMedia: [
        {
          mediaId: ready.mediaId,
          kind: "image",
          localPath: "/uploads/imports/source-1.png",
        },
      ],
    });
    expect(metadata).not.toHaveProperty("inputPublicUrls");
    expect(JSON.stringify(metadata)).not.toContain("signature=temporary");
  });

  it("persists and submits legacy/tool/legacy image inputs in UI order", async () => {
    const ready = await upload();
    boundary.kieCreateTask.mockResolvedValueOnce({ taskId: "provider-task" });

    await expect(
      createImageGeneration({
        authUserId: 7,
        prompt: "test",
        model: "google/nano-banana-edit",
        toolMediaIds: [ready.mediaId],
        imagePaths: [
          "/uploads/product-library/legacy-a.png",
          "/uploads/product-library/legacy-c.png",
        ],
        inputManifest: {
          version: 1,
          items: [
            {
              position: 0,
              source: "legacy_path",
              path: "/uploads/product-library/legacy-a.png",
            },
            { position: 1, source: "tool_media", mediaId: ready.mediaId },
            {
              position: 2,
              source: "legacy_path",
              path: "/uploads/product-library/legacy-c.png",
            },
          ],
        },
      }),
    ).resolves.toMatchObject({ taskId: "provider-task", status: "running" });

    expect(boundary.state.links).toEqual([
      {
        generationId: 1,
        mediaId: ready.mediaId,
        position: 1,
        role: "reference_image",
      },
    ]);
    expect(
      JSON.parse(String(boundary.state.generations.get(1)?.templateData))
        .imagePaths,
    ).toEqual([
      "/uploads/product-library/legacy-a.png",
      "/uploads/imports/source-1.png",
      "/uploads/product-library/legacy-c.png",
    ]);
    expect(boundary.kieCreateTask.mock.calls[0][0].input.image_urls).toEqual([
      "https://model.example.com/uploads/product-library/legacy-a.png",
      "https://oss.example.com/uploads/tool-input-relay/source-1.png",
      "https://model.example.com/uploads/product-library/legacy-c.png",
    ]);
  });

  it("submits uploaded media to nano-banana-pro as image_input", async () => {
    const ready = await upload();
    boundary.kieCreateTask.mockResolvedValueOnce({ taskId: "provider-task" });

    await expect(
      createImageGeneration({
        authUserId: 7,
        prompt: "test",
        model: "nano-banana-pro",
        toolMediaIds: [ready.mediaId],
      }),
    ).resolves.toMatchObject({ taskId: "provider-task", status: "running" });

    expect(boundary.kieCreateTask.mock.calls[0][0].input.image_input).toEqual([
      "https://oss.example.com/uploads/tool-input-relay/source-1.png",
    ]);
  });

  it.each(["tool", "canvas", "agent", "batch"] as const)("compiles image mentions for %s while preserving the swapped input order", async (source) => {
    const first = await upload();
    const second = await upload();
    boundary.kieCreateTask.mockResolvedValueOnce({ taskId: "provider-task" });
    await createImageGeneration({
      authUserId: 7, source, model: "google/nano-banana-edit",
      prompt: "@图片2 参考 @图片1，保留 @图片10",
      toolMediaIds: [second.mediaId, first.mediaId],
    });
    const submitted = boundary.kieCreateTask.mock.calls[0][0].input;
    expect(submitted.prompt).toBe("图片2 参考 图片1，保留 @图片10");
    expect(boundary.state.links.map((link) => link.mediaId)).toEqual([second.mediaId, first.mediaId]);
    expect(submitted.image_urls).toHaveLength(2);
  });

  it("stores the original Skill user prompt in image asset parameters", async () => {
    const ready = await upload();
    boundary.kieCreateTask.mockResolvedValueOnce({ taskId: "provider-task" });

    await createImageGeneration({
      authUserId: 7,
      prompt: "Skill 生成的最终提示词",
      userPrompt: "用户原始提示词",
      model: "google/nano-banana-edit",
      toolMediaIds: [ready.mediaId],
    });

    expect(JSON.parse(String(boundary.state.generations.get(1)?.templateData))).toMatchObject({
      prompt: "Skill 生成的最终提示词",
      userPrompt: "用户原始提示词",
    });
  });

  it("scopes draft recovery by both owner and draft session", async () => {
    const ready = await upload();

    await expect(
      listToolMediaDrafts({ ownerUserId: 8, draftSessionId: draftA }),
    ).resolves.toEqual([]);
    await expect(
      listToolMediaDrafts({ ownerUserId: 7, draftSessionId: draftB }),
    ).resolves.toEqual([]);
    await expect(
      listToolMediaDrafts({ ownerUserId: 7, draftSessionId: draftA }),
    ).resolves.toEqual([
      expect.objectContaining({
        mediaId: ready.mediaId,
        localPreviewUrl: "/uploads/imports/source-1.png",
      }),
    ]);
  });

  it("release plus GC deletes an unused local source and its relay object", async () => {
    const ready = await upload();
    await releaseToolMedia({
      ownerUserId: 7,
      draftSessionId: draftA,
      mediaIds: [ready.mediaId],
    });
    boundary.state.now = new Date("2026-07-24T12:11:00.000Z");

    await expect(
      runCanvasMediaGcBatch(prisma as never, {
        workerId: "gc-worker",
        now: boundary.state.now,
      }),
    ).resolves.toEqual({ claimed: 1, purged: 1, failed: 0 });

    expect(boundary.deleteOssObjects).toHaveBeenCalledWith([
      "uploads/tool-input-relay/source-1.png",
    ]);
    expect(boundary.deleteStoredMediaRefs).toHaveBeenCalledWith(
      ["/uploads/imports/source-1.png"],
      {
        localOnly: true,
        canonicalGenerationOutputs: true,
        canonicalGenerationMediaIds: [ready.mediaId],
      },
    );
    expect(boundary.state.media.get(ready.mediaId)).toMatchObject({
      status: "purged",
      originalKey: null,
    });
    expect(
      boundary.state.sql.filter((sql) => sql.includes("GenerationInputMedia")),
    ).toHaveLength(2);
  });

  it("after the 30 minute terminal grace deletes only relay and preserves originalKey and links", async () => {
    const ready = await upload();
    await failImageTask(ready.mediaId);
    boundary.state.generations.get(1)!.finishedAt = new Date(
      "2026-07-24T12:00:00.000Z",
    );
    boundary.state.now = new Date("2026-07-24T12:30:00.000Z");

    await expect(
      runToolMediaRelayMaintenanceBatch(prisma as never, {
        workerId: "relay-worker",
        now: boundary.state.now,
      }),
    ).resolves.toEqual({ claimed: 1, purged: 1, failed: 0 });

    const asset = boundary.state.media.get(ready.mediaId)!;
    expect(boundary.deleteOssObjects).toHaveBeenCalledWith([
      "uploads/tool-input-relay/source-1.png",
    ]);
    expect(asset.variants).not.toHaveProperty("relay");
    expect(asset.originalKey).toBe("/uploads/imports/source-1.png");
    expect(boundary.state.links).toHaveLength(1);
    expect(
      boundary.state.sql.some((sql) => sql.includes("INTERVAL '30 minutes'")),
    ).toBe(true);

    boundary.buildAppPublicUploadUrl.mockReturnValue("");
    await failImageTask(ready.mediaId);
    expect(asset.variants.relay).toEqual({
      objectKey: "uploads/tool-input-relay/source-1.png",
      createdAt: expect.any(String),
    });
    expect(boundary.state.links).toHaveLength(2);
  });
});
