import { buildSunoRequest, isSunoModel, type SunoInput } from "@/lib/suno-models";
import { submitSuno, SunoRequestError } from "@/lib/suno";
import { sanitizeProviderErrorText } from "@/lib/providers/error-safety";
import "server-only";

import prisma from "@/lib/prisma";
import { reserveRuntimeGeneration } from "@/lib/runtime-generation-budget";
import { assertBillingReady } from "@/lib/billing/admission";
import { upsertUsageLedgerForGenerationId } from "@/lib/billing-ledger";
import { persistGenerationProviderUsage } from "@/lib/billing/usage-persistence";
import { upsertAdminAssetFeedForGenerationId } from "@/lib/admin-asset-feed";
import { generationOutputFolder } from "@/lib/generation/output-folder";
import { runGenerationRequestIdempotently } from "@/lib/generation/request-key-idempotency";
import { isAudioModelVisible } from "@/lib/image-edit-models";
import { miniMaxGenerateSpeech } from "@/lib/minimax-speech";
import {
  buildMiniMaxSpeechRequest,
  type MiniMaxSpeechSettings,
} from "@/lib/minimax-speech-models";
import { isProviderModelEnabled } from "@/lib/providers/model-availability";
import { getRegisteredProviders } from "@/lib/providers/registry";
import { saveBufferFile, saveRemoteFile } from "@/lib/storage";
import { buildSeedAudioRequest, isSeedAudioModel, SEED_AUDIO_OUTPUT_FILES, SEED_AUDIO_PROVIDER_ID, type SeedAudioSettings } from "@/lib/seed-audio-models";
import { prepareSeedAudioReferences, seedAudioGenerate } from "@/lib/seed-audio";

export type CreateAudioGenerationInput = (MiniMaxSpeechSettings | SeedAudioSettings | (SunoInput & { text: string })) & {
  canvasId?: number;
  authUserId: number;
  requestKey: string;
  source: "canvas";
  outputStorage?: {
    folder: string;
    stableKey: string;
    fallbackExt: string;
  };
};

export type CreateAudioGenerationResult = {
  generationId: number;
  status: "running" | "success";
  outputPath?: string;
  durationSeconds?: number;
  usageCharacters?: number;
};

export class AudioGenerationError extends Error {
  status: number;
  generationId?: number;

  constructor(message: string, status: number, generationId?: number) {
    super(message);
    this.name = "AudioGenerationError";
    this.status = status;
    this.generationId = generationId;
  }
}

function parseTemplateData(raw: string | null) {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    return {};
  }
}

async function findExisting(input: CreateAudioGenerationInput) {
  return prisma.generation.findFirst({
    where: {
      requestKey: input.requestKey,
      authUserId: input.authUserId,
      type: "audio_gen",
    },
  });
}

function resultFromExisting(
  existing: Awaited<ReturnType<typeof findExisting>>,
): CreateAudioGenerationResult {
  if (!existing) throw new AudioGenerationError("音频任务不存在", 404);
  if (existing.status === "failed") {
    throw new AudioGenerationError(
      existing.errorMsg || "音频生成失败",
      409,
      existing.id,
    );
  }
  const metadata = parseTemplateData(existing.templateData) as Record<
    string,
    any
  >;
  return {
    generationId: existing.id,
    status:
      existing.status === "success" && existing.localPath
        ? "success"
        : "running",
    outputPath: existing.localPath || undefined,
    durationSeconds: Number.isFinite(Number(metadata.durationSeconds))
      ? Number(metadata.durationSeconds)
      : undefined,
    usageCharacters: Number.isFinite(
      Number(metadata.providerUsage?.usage_characters),
    )
      ? Number(metadata.providerUsage.usage_characters)
      : undefined,
  };
}

async function createAudioGenerationOnce(
  input: CreateAudioGenerationInput,
): Promise<CreateAudioGenerationResult> {
  if (isSunoModel(input.model)) return createSunoGeneration(input as CreateAudioGenerationInput & SunoInput);
  if (isSeedAudioModel(input.model)) return createSeedAudioGeneration(input as SeedAudioGenerationInput);
  let request: ReturnType<typeof buildMiniMaxSpeechRequest>;
  try {
    request = buildMiniMaxSpeechRequest(input as MiniMaxSpeechSettings);
  } catch (error) {
    throw new AudioGenerationError(
      error instanceof Error ? error.message : "语音参数不合法",
      400,
    );
  }

  const [providers, visible] = await Promise.all([
    getRegisteredProviders(),
    isAudioModelVisible(input.model),
  ]);
  if (!visible || !isProviderModelEnabled(providers, "audio", input.model)) {
    throw new AudioGenerationError("该 MiniMax 语音模型当前不可用", 400);
  }

  const speech = input as MiniMaxSpeechSettings;
  const templateData = {
    taskType: "audio_gen",
    provider: "minimax",
    providerModel: input.model,
    model: input.model,
    voiceId: speech.voiceId,
    speed: speech.speed,
    pitch: speech.pitch,
    volume: speech.volume,
    modifyPitch: speech.modifyPitch,
    modifyIntensity: speech.modifyIntensity,
    modifyTimbre: speech.modifyTimbre,
    soundEffect: speech.soundEffect,
    ...(speech.emotion ? { emotion: speech.emotion } : {}),
    audioSetting: request.body.audio_setting,
  };
  const record = await prisma.generation.create({
    data: {
      userId: String(input.authUserId),
      authUserId: input.authUserId,
      requestKey: input.requestKey, canvasId: input.canvasId,
      type: "audio_gen",
      source: input.source,
      prompt: request.body.text,
      model: input.model,
      status: "running",
      externalProvider: "minimax",
      externalTaskId: null,
      localPath: null,
      finishedAt: null,
      templateData: JSON.stringify(templateData),
    },
  });
  void upsertUsageLedgerForGenerationId(record.id).catch(() => null);
  void upsertAdminAssetFeedForGenerationId(record.id).catch(() => null);

  try {
    const result = await miniMaxGenerateSpeech(speech);
    const billingTemplateData = await persistGenerationProviderUsage(record, {
      usage_characters: result.usageCharacters,
      audio_length_ms: result.audioLengthMs,
      audio_size: result.audioSize,
      trace_id: result.traceId,
    });
    const outputStorage = input.outputStorage;
    const outputPath = await saveRemoteFile(
      result.audioUrl,
      outputStorage?.folder || generationOutputFolder("audio_gen", input.source),
      false,
      {
        providerId: "minimax",
        ...(outputStorage
          ? {
              stableKey: outputStorage.stableKey,
              dateSubdirectory: false,
              fallbackExt: outputStorage.fallbackExt,
            }
          : {}),
      },
    );
    const durationSeconds =
      result.audioLengthMs != null
        ? Number((result.audioLengthMs / 1000).toFixed(3))
        : undefined;
    const finalTemplateData = {
      ...billingTemplateData,
      durationSeconds,
    };
    await prisma.generation.update({
      where: { id: record.id },
      data: {
        status: "success",
        localPath: outputPath,
        sizeBytes: result.audioSize,
        errorMsg: null,
        finishedAt: new Date(),
        templateData: JSON.stringify(finalTemplateData),
      },
    });
    void upsertUsageLedgerForGenerationId(record.id).catch(() => null);
    void upsertAdminAssetFeedForGenerationId(record.id).catch(() => null);
    return {
      generationId: record.id,
      status: "success",
      outputPath,
      durationSeconds,
      usageCharacters: result.usageCharacters,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "MiniMax 语音生成失败";
    await prisma.generation.update({
      where: { id: record.id },
      data: { status: "failed", errorMsg: message, finishedAt: new Date() },
    });
    void upsertUsageLedgerForGenerationId(record.id).catch(() => null);
    void upsertAdminAssetFeedForGenerationId(record.id).catch(() => null);
    const status =
      Number((error as { statusCode?: unknown })?.statusCode) || 502;
    throw new AudioGenerationError(message, status, record.id);
  }
}

type SeedAudioGenerationInput = SeedAudioSettings & Pick<CreateAudioGenerationInput, "authUserId" | "requestKey" | "source" | "outputStorage" | "canvasId">;

async function createSeedAudioGeneration(input: SeedAudioGenerationInput): Promise<CreateAudioGenerationResult> {
  let request: ReturnType<typeof buildSeedAudioRequest>;
  let references: Awaited<ReturnType<typeof prepareSeedAudioReferences>>;
  try {
    request = buildSeedAudioRequest(input);
    const [providers, visible] = await Promise.all([getRegisteredProviders(), isAudioModelVisible(input.model)]);
    if (!visible || !isProviderModelEnabled(providers, "audio", input.model)) throw new Error("Seed Audio 1.0 当前不可用");
    references = await prepareSeedAudioReferences(input);
  } catch (error) {
    throw new AudioGenerationError(error instanceof Error ? error.message : "Seed Audio 参数不合法", 400);
  }
  const templateData = {
    taskType: "audio_gen", provider: SEED_AUDIO_PROVIDER_ID, providerModel: input.model, model: input.model,
    audioConfig: request.body.audio_config,
    references: input.references || [],
    // Keep source paths and request parameters, never large Base64 media in the database.
    billing: { unitType: "second" },
  };
  const record = await prisma.generation.create({ data: {
    userId: String(input.authUserId), authUserId: input.authUserId, requestKey: input.requestKey, canvasId: input.canvasId,
    type: "audio_gen", source: input.source, prompt: request.body.text_prompt, model: input.model,
    status: "running", externalProvider: SEED_AUDIO_PROVIDER_ID, externalTaskId: null, localPath: null, finishedAt: null,
    templateData: JSON.stringify(templateData),
  } });
  void upsertUsageLedgerForGenerationId(record.id).catch(() => null);
  void upsertAdminAssetFeedForGenerationId(record.id).catch(() => null);
  try {
    const result = await seedAudioGenerate(input, input.requestKey, references);
    const billingTemplateData = await persistGenerationProviderUsage(record, {
      original_duration: result.originalDurationSeconds, duration: result.durationSeconds, trace_id: result.traceId,
    });
    const folder = input.outputStorage?.folder || generationOutputFolder("audio_gen", input.source);
    const outputFile = SEED_AUDIO_OUTPUT_FILES[request.body.audio_config.format];
    const outputPath = result.audioBuffer
      ? await saveBufferFile(result.audioBuffer, folder, { fileName: `audio.${outputFile.extension}`, contentType: outputFile.contentType, fallbackExt: outputFile.extension })
      : await saveRemoteFile(result.audioUrl!, folder, false, { providerId: SEED_AUDIO_PROVIDER_ID, stableKey: input.requestKey, fallbackExt: outputFile.extension });
    await prisma.generation.update({ where: { id: record.id }, data: {
      status: "success", localPath: outputPath, sizeBytes: result.audioBuffer?.length, errorMsg: null, finishedAt: new Date(),
      templateData: JSON.stringify({ ...billingTemplateData, durationSeconds: result.durationSeconds }),
    } });
    void upsertUsageLedgerForGenerationId(record.id).catch(() => null);
    void upsertAdminAssetFeedForGenerationId(record.id).catch(() => null);
    return { generationId: record.id, status: "success", outputPath, durationSeconds: result.durationSeconds };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Seed Audio 生成失败";
    await prisma.generation.update({ where: { id: record.id }, data: { status: "failed", errorMsg: message, finishedAt: new Date() } });
    void upsertUsageLedgerForGenerationId(record.id).catch(() => null);
    void upsertAdminAssetFeedForGenerationId(record.id).catch(() => null);
    throw new AudioGenerationError(message, Number((error as { statusCode?: number })?.statusCode) || 502, record.id);
  }
}

async function createSunoGeneration(input: CreateAudioGenerationInput & SunoInput): Promise<CreateAudioGenerationResult> {
  let body: Record<string, unknown>;
  try { body = buildSunoRequest(input); } catch (e) { throw new AudioGenerationError(e instanceof Error ? e.message : "音乐参数不合法", 400); }
  const [providers, visible] = await Promise.all([getRegisteredProviders(), isAudioModelVisible(input.model)]);
  if (!visible || !isProviderModelEnabled(providers, "audio", input.model)) throw new AudioGenerationError("该 Suno 模型当前不可用", 400);
  const metadata = { taskType: "audio_gen", provider: "apimart", providerModel: "suno", model: input.model,
    suno: input.suno, sunoRequest: body, maxMode: body.max_mode === true,
    billing: { unitType: "request", childBillable: false }, phase: "submitting" };
  const record = await prisma.generation.create({ data: {
    userId: String(input.authUserId), authUserId: input.authUserId, requestKey: input.requestKey, canvasId: input.canvasId,
    type: "audio_gen", source: "canvas", prompt: String(body.prompt || body.style || ""), model: input.model,
    status: "running", externalProvider: "apimart", externalTaskId: null, localPath: null,
    templateData: JSON.stringify(metadata),
  } });
  let taskId: string | undefined;
  try {
    taskId = await submitSuno(body);
    // Retry a receipt write only; never repeat the billable POST.
    let persisted = false;
    for (let attempt = 0; attempt < 3 && !persisted; attempt++) {
      try {
        await prisma.generation.update({ where: { id: record.id }, data: { externalTaskId: taskId,
          templateData: JSON.stringify({ ...metadata, phase: "generating" }) } });
        persisted = true;
      } catch (error) { if (attempt === 2) throw error; }
    }
  } catch (error) {
    const rejected = error instanceof SunoRequestError && error.rejected;
    const message = rejected ? sanitizeProviderErrorText(error.message) : "提交状态待核实，请勿重复生成；联系管理员核对上游任务";
    await prisma.generation.update({ where: { id: record.id }, data: {
      status: rejected ? "failed" : "running", errorMsg: taskId ? null : message,
      ...(taskId ? { externalTaskId: taskId } : {}),
      ...(rejected ? { finishedAt: new Date() } : {}),
      templateData: JSON.stringify({ ...metadata, phase: rejected ? "failed" : taskId ? "generating" : "submission_unknown" }),
    } });
    if (rejected) throw new AudioGenerationError(message, 400, record.id);
  } finally {
    void upsertUsageLedgerForGenerationId(record.id).catch(() => null);
    void upsertAdminAssetFeedForGenerationId(record.id).catch(() => null);
  }
  return { generationId: record.id, status: "running" };
}

export async function createAudioGeneration(input: CreateAudioGenerationInput) {
  return runGenerationRequestIdempotently({
    requestKey: input.requestKey,
    execute: async () => { await assertBillingReady(input.model); await reserveRuntimeGeneration(input.requestKey); return createAudioGenerationOnce(input); },
    findExisting: () => findExisting(input),
    mapExisting: resultFromExisting,
  });
}
