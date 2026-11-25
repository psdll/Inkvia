import "server-only";

import fs from "fs-extra";
import path from "node:path";
import { createHash } from "node:crypto";
import { open } from "node:fs/promises";

import { createAudioGeneration } from "@/lib/generation/audio-service";
import type { MiniMaxSpeechModelId } from "@/lib/minimax-speech-models";
import { resolveUploadsRootDirectory, saveRemoteFile } from "@/lib/storage";

export const MINIMAX_VOICE_PREVIEW_TEXT =
  "欢迎试听音色，挑选一个你喜欢的音色，让声音为我们讲述故事吧";
export const MINIMAX_VOICE_PREVIEW_FOLDER = "canvas_voice_previews";

type PreviewIdentity = {
  model: MiniMaxSpeechModelId;
  voiceId: string;
};

type CreatePreviewInput = PreviewIdentity & {
  authUserId: number;
  requestKey: string;
};

const inFlight = new Map<string, Promise<MiniMaxVoicePreviewResult>>();
const PREVIEW_LOCK_POLL_MS = 100;
const PREVIEW_LOCK_WAIT_MS = 6 * 60 * 1_000;
const PREVIEW_LOCK_STALE_MS = 10 * 60 * 1_000;

export type MiniMaxVoicePreviewResult = {
  generationId?: number;
  status: "success";
  outputPath: string;
  usageCharacters?: number;
  cached: boolean;
};

export function miniMaxVoicePreviewTarget(
  model: MiniMaxSpeechModelId,
  voiceId: string,
) {
  const stableKey = createHash("sha256")
    .update(
      `minimax-voice-preview-v1\0${model}\0${String(voiceId || "").trim()}`,
    )
    .digest("hex");
  const fileName = `${stableKey}.mp3`;
  return {
    stableKey,
    publicPath: `/uploads/${MINIMAX_VOICE_PREVIEW_FOLDER}/${fileName}`,
    diskPath: path.join(
      resolveUploadsRootDirectory(),
      ...MINIMAX_VOICE_PREVIEW_FOLDER.split("/"),
      fileName,
    ),
  };
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function findMiniMaxVoicePreviewByTarget(
  target: ReturnType<typeof miniMaxVoicePreviewTarget>,
) {
  try {
    const stat = await fs.stat(target.diskPath);
    return stat.isFile() && stat.size > 0 ? target.publicPath : null;
  } catch {
    return null;
  }
}

async function acquirePreviewFileLock(
  target: ReturnType<typeof miniMaxVoicePreviewTarget>,
) {
  const lockPath = `${target.diskPath}.lock`;
  const deadline = Date.now() + PREVIEW_LOCK_WAIT_MS;
  await fs.ensureDir(path.dirname(target.diskPath));

  while (true) {
    const cached = await findMiniMaxVoicePreviewByTarget(target);
    if (cached) return { cachedPath: cached } as const;

    try {
      const handle = await open(lockPath, "wx", 0o600);
      return {
        release: async () => {
          await handle.close();
          await fs.remove(lockPath).catch(() => undefined);
        },
      } as const;
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== "EEXIST") throw error;
      const lockStat = await fs.stat(lockPath).catch(() => null);
      if (lockStat && Date.now() - lockStat.mtimeMs > PREVIEW_LOCK_STALE_MS) {
        await fs.remove(lockPath).catch(() => undefined);
        continue;
      }
      if (Date.now() >= deadline) {
        throw new Error("音色试听正在生成，请稍后重试");
      }
      await wait(PREVIEW_LOCK_POLL_MS);
    }
  }
}

export async function findMiniMaxVoicePreview(
  model: MiniMaxSpeechModelId,
  voiceId: string,
) {
  const target = miniMaxVoicePreviewTarget(model, voiceId);
  return findMiniMaxVoicePreviewByTarget(target);
}

export async function saveMiniMaxVoicePreviewFromRemote({
  model,
  voiceId,
  audioUrl,
}: PreviewIdentity & { audioUrl: string }) {
  const target = miniMaxVoicePreviewTarget(model, voiceId);
  return saveRemoteFile(audioUrl, MINIMAX_VOICE_PREVIEW_FOLDER, false, {
    providerId: "minimax",
    stableKey: target.stableKey,
    dateSubdirectory: false,
    fallbackExt: "mp3",
  });
}

async function generatePreview(
  input: CreatePreviewInput,
): Promise<MiniMaxVoicePreviewResult> {
  const cached = await findMiniMaxVoicePreview(input.model, input.voiceId);
  if (cached) return { status: "success", outputPath: cached, cached: true };

  const target = miniMaxVoicePreviewTarget(input.model, input.voiceId);
  const result = await createAudioGeneration({
    authUserId: input.authUserId,
    requestKey: input.requestKey,
    source: "canvas",
    model: input.model,
    text: MINIMAX_VOICE_PREVIEW_TEXT,
    voiceId: input.voiceId,
    speed: 1,
    pitch: 0,
    volume: 1,
    modifyPitch: 0,
    modifyIntensity: 0,
    modifyTimbre: 0,
    soundEffect: "",
    outputStorage: {
      folder: MINIMAX_VOICE_PREVIEW_FOLDER,
      stableKey: target.stableKey,
      fallbackExt: "mp3",
    },
  });
  return {
    generationId: result.generationId,
    status: "success",
    outputPath: result.outputPath || target.publicPath,
    usageCharacters: result.usageCharacters,
    cached: false,
  };
}

async function generatePreviewWithFileLock(
  input: CreatePreviewInput,
): Promise<MiniMaxVoicePreviewResult> {
  const target = miniMaxVoicePreviewTarget(input.model, input.voiceId);
  const lock = await acquirePreviewFileLock(target);
  if (typeof lock.cachedPath === "string") {
    return { status: "success", outputPath: lock.cachedPath, cached: true };
  }
  try {
    return await generatePreview(input);
  } finally {
    await lock.release();
  }
}

export async function getOrCreateMiniMaxVoicePreview(
  input: CreatePreviewInput,
) {
  const target = miniMaxVoicePreviewTarget(input.model, input.voiceId);
  const cached = await findMiniMaxVoicePreview(input.model, input.voiceId);
  if (cached)
    return { status: "success" as const, outputPath: cached, cached: true };

  const pending = inFlight.get(target.stableKey);
  if (pending) return pending;

  const operation = generatePreviewWithFileLock(input);
  inFlight.set(target.stableKey, operation);
  try {
    return await operation;
  } finally {
    if (inFlight.get(target.stableKey) === operation) {
      inFlight.delete(target.stableKey);
    }
  }
}
