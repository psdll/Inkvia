import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createAudioGeneration: vi.fn(),
  saveRemoteFile: vi.fn(),
}));

vi.mock("@/lib/generation/audio-service", () => ({
  createAudioGeneration: mocks.createAudioGeneration,
}));

vi.mock("@/lib/storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/storage")>()),
  saveRemoteFile: mocks.saveRemoteFile,
}));

import {
  findMiniMaxVoicePreview,
  getOrCreateMiniMaxVoicePreview,
  miniMaxVoicePreviewTarget,
  saveMiniMaxVoicePreviewFromRemote,
} from "@/lib/generation/audio-preview-cache";

describe("MiniMax voice preview persistent cache", () => {
  let uploadsRoot = "";
  const previousUploadsDir = process.env.UPLOADS_DIR;

  beforeEach(async () => {
    vi.clearAllMocks();
    uploadsRoot = await fs.mkdtemp(path.join(os.tmpdir(), "voice-preview-"));
    process.env.UPLOADS_DIR = uploadsRoot;
    mocks.createAudioGeneration.mockImplementation(async (input: any) => {
      const target = miniMaxVoicePreviewTarget(input.model, input.voiceId);
      await fs.mkdir(path.dirname(target.diskPath), { recursive: true });
      await fs.writeFile(target.diskPath, "saved preview audio");
      return {
        generationId: 91,
        status: "success",
        outputPath: target.publicPath,
        usageCharacters: 10,
      };
    });
  });

  afterEach(async () => {
    if (previousUploadsDir == null) delete process.env.UPLOADS_DIR;
    else process.env.UPLOADS_DIR = previousUploadsDir;
    await fs.rm(uploadsRoot, { recursive: true, force: true });
  });

  it("uses a deterministic model-and-voice file under the canvas audio folder", () => {
    const first = miniMaxVoicePreviewTarget("speech-2.8-hd", "female-shaonv");
    const same = miniMaxVoicePreviewTarget("speech-2.8-hd", "female-shaonv");
    const turbo = miniMaxVoicePreviewTarget(
      "speech-2.8-turbo",
      "female-shaonv",
    );

    expect(first).toEqual(same);
    expect(first.publicPath).toMatch(
      /^\/uploads\/canvas_voice_previews\/[a-f0-9]{64}\.mp3$/,
    );
    expect(first.diskPath).toBe(
      path.join(uploadsRoot, "canvas_voice_previews", `${first.stableKey}.mp3`),
    );
    expect(turbo.publicPath).not.toBe(first.publicPath);
  });

  it("generates once, reuses the saved file, and regenerates after deletion", async () => {
    const input = {
      authUserId: 29,
      requestKey: "00000000-0000-4000-8000-000000000091",
      model: "speech-2.8-hd" as const,
      voiceId: "female-shaonv",
    };

    const first = await getOrCreateMiniMaxVoicePreview(input);
    const second = await getOrCreateMiniMaxVoicePreview({
      ...input,
      requestKey: "00000000-0000-4000-8000-000000000092",
    });

    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
    expect(second.outputPath).toBe(first.outputPath);
    expect(mocks.createAudioGeneration).toHaveBeenCalledTimes(1);
    expect(mocks.createAudioGeneration).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "欢迎试听音色，挑选一个你喜欢的音色，让声音为我们讲述故事吧",
      }),
    );

    const target = miniMaxVoicePreviewTarget(input.model, input.voiceId);
    await fs.unlink(target.diskPath);
    expect(
      await findMiniMaxVoicePreview(input.model, input.voiceId),
    ).toBeNull();

    const third = await getOrCreateMiniMaxVoicePreview({
      ...input,
      requestKey: "00000000-0000-4000-8000-000000000093",
    });
    expect(third.cached).toBe(false);
    expect(mocks.createAudioGeneration).toHaveBeenCalledTimes(2);
  });

  it("waits for another server process and reuses its saved file", async () => {
    const input = {
      authUserId: 30,
      requestKey: "00000000-0000-4000-8000-000000000094",
      model: "speech-2.8-hd" as const,
      voiceId: "female-shaonv",
    };
    const target = miniMaxVoicePreviewTarget(input.model, input.voiceId);
    const lockPath = `${target.diskPath}.lock`;
    await fs.mkdir(path.dirname(target.diskPath), { recursive: true });
    await fs.writeFile(lockPath, "another-process");

    const externalSave = new Promise<void>((resolve, reject) => {
      setTimeout(() => {
        void (async () => {
          try {
            await fs.writeFile(target.diskPath, "shared preview audio");
            await fs.unlink(lockPath);
            resolve();
          } catch (error) {
            reject(error);
          }
        })();
      }, 50);
    });

    const result = await getOrCreateMiniMaxVoicePreview(input);
    await externalSave;

    expect(result).toEqual({
      status: "success",
      outputPath: target.publicPath,
      cached: true,
    });
    expect(mocks.createAudioGeneration).not.toHaveBeenCalled();
  });

  it("shares one local file when different users preview concurrently", async () => {
    const target = miniMaxVoicePreviewTarget(
      "speech-2.8-turbo",
      "female-shaonv",
    );
    let finishGeneration!: () => void;
    const generationGate = new Promise<void>((resolve) => {
      finishGeneration = resolve;
    });
    let generationStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      generationStarted = resolve;
    });
    mocks.createAudioGeneration.mockImplementationOnce(async () => {
      generationStarted();
      await generationGate;
      await fs.mkdir(path.dirname(target.diskPath), { recursive: true });
      await fs.writeFile(target.diskPath, "one shared preview audio");
      return {
        generationId: 95,
        status: "success",
        outputPath: target.publicPath,
        usageCharacters: 10,
      };
    });

    const firstUser = getOrCreateMiniMaxVoicePreview({
      authUserId: 31,
      requestKey: "00000000-0000-4000-8000-000000000095",
      model: "speech-2.8-turbo",
      voiceId: "female-shaonv",
    });
    await started;
    const secondUser = getOrCreateMiniMaxVoicePreview({
      authUserId: 32,
      requestKey: "00000000-0000-4000-8000-000000000096",
      model: "speech-2.8-turbo",
      voiceId: "female-shaonv",
    });
    finishGeneration();

    const [first, second] = await Promise.all([firstUser, secondUser]);
    expect(first.outputPath).toBe(target.publicPath);
    expect(second.outputPath).toBe(target.publicPath);
    expect(mocks.createAudioGeneration).toHaveBeenCalledTimes(1);
    await expect(fs.readdir(path.dirname(target.diskPath))).resolves.toEqual([
      path.basename(target.diskPath),
    ]);
  });

  it("saves a clone preview URL into the same persistent cache folder", async () => {
    const target = miniMaxVoicePreviewTarget("speech-2.8-hd", "CanvasVoice01");
    mocks.saveRemoteFile.mockResolvedValue(target.publicPath);

    await expect(
      saveMiniMaxVoicePreviewFromRemote({
        model: "speech-2.8-hd",
        voiceId: "CanvasVoice01",
        audioUrl: "https://cdn.minimax.test/clone-preview.mp3",
      }),
    ).resolves.toBe(target.publicPath);

    expect(mocks.saveRemoteFile).toHaveBeenCalledWith(
      "https://cdn.minimax.test/clone-preview.mp3",
      "canvas_voice_previews",
      false,
      {
        providerId: "minimax",
        stableKey: target.stableKey,
        dateSubdirectory: false,
        fallbackExt: "mp3",
      },
    );
  });
});
