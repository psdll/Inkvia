export const MINIMAX_SPEECH_HD_MODEL_ID = "speech-2.8-hd" as const;
export const MINIMAX_SPEECH_TURBO_MODEL_ID = "speech-2.8-turbo" as const;
export const MINIMAX_SPEECH_MODEL_IDS = [
  MINIMAX_SPEECH_HD_MODEL_ID,
  MINIMAX_SPEECH_TURBO_MODEL_ID,
] as const;

export type MiniMaxSpeechModelId = (typeof MINIMAX_SPEECH_MODEL_IDS)[number];
export const MINIMAX_SPEECH_EMOTIONS = ["calm", "happy", "sad", "angry", "fearful", "disgusted", "surprised"] as const;
export type MiniMaxSpeechEmotion = (typeof MINIMAX_SPEECH_EMOTIONS)[number];
export type MiniMaxSpeechSoundEffect =
  "" | "spacious_echo" | "auditorium_echo" | "lofi_telephone" | "robotic";

export type MiniMaxSpeechSettings = {
  model: MiniMaxSpeechModelId;
  text: string;
  voiceId: string;
  speed: number;
  pitch: number;
  volume: number;
  modifyPitch: number;
  modifyIntensity: number;
  modifyTimbre: number;
  soundEffect: MiniMaxSpeechSoundEffect;
  emotion?: MiniMaxSpeechEmotion;
};

export type MiniMaxVoiceCloneSettings = {
  fileId: number;
  model: MiniMaxSpeechModelId;
  voiceId: string;
  previewText: string;
  needNoiseReduction: boolean;
  needVolumeNormalization: boolean;
};

export const MINIMAX_SPEECH_TEXT_MAX_LENGTH = 9_999;
export const MINIMAX_SPEECH_DEFAULT_VOICE_ID = "female-shaonv";
export const MINIMAX_SPEECH_DEFAULT_VOICE_NAME = "少女音色";

export const MINIMAX_SPEECH_SOUND_EFFECTS: Array<{
  value: MiniMaxSpeechSoundEffect;
  label: string;
}> = [
  { value: "", label: "无" },
  { value: "spacious_echo", label: "空旷回音" },
  { value: "auditorium_echo", label: "礼堂广播" },
  { value: "lofi_telephone", label: "电话失真" },
  { value: "robotic", label: "电音" },
];

export const MINIMAX_SPEECH_INTERJECTIONS = [
  ["笑声", "(laughs)"],
  ["轻笑", "(chuckle)"],
  ["咳嗽", "(coughs)"],
  ["清嗓", "(clear-throat)"],
  ["呻吟", "(groans)"],
  ["换气", "(breath)"],
  ["喘气", "(pant)"],
  ["吸气", "(inhale)"],
  ["呼气", "(exhale)"],
  ["倒吸气", "(gasps)"],
  ["吸鼻子", "(sniffs)"],
  ["叹气", "(sighs)"],
  ["喷鼻息", "(snorts)"],
  ["打嗝", "(burps)"],
  ["咂嘴", "(lip-smacking)"],
  ["哼唱", "(humming)"],
  ["嘶嘶声", "(hissing)"],
  ["嗯", "(emm)"],
  ["喷嚏", "(sneezes)"],
] as const;

// HTTP T2A capabilities, not the separate async API. Only expose confirmed options.
export function getMiniMaxSpeechCapabilities(model: string) {
  const supported = isMiniMaxSpeechModel(model);
  return {
    pause: supported,
    parameters: supported,
    interjections: supported ? MINIMAX_SPEECH_INTERJECTIONS : [],
    emotions: supported ? MINIMAX_SPEECH_EMOTIONS : [],
  };
}

export function validateMiniMaxSpeechPauses(text: string) {
  const markers = [...text.matchAll(/<#[^<>]*>/g)];
  for (const marker of markers) {
    const seconds = Number(marker[0].slice(2, -2));
    if (!/^<#\d+(?:\.\d{1,2})?#>$/.test(marker[0]) || seconds < 0.01 || seconds > 99.99) {
      throw new Error("停顿时长必须为 0.01–99.99 秒，最多两位小数");
    }
  }
  if (markers.length && text.split(/<#[^<>]*>/g).some((part) => !part.trim())) {
    throw new Error("停顿必须放在两段文字之间，不能连续插入或位于文本首尾");
  }
}

function finiteNumber(
  label: string,
  value: number,
  min: number,
  max: number,
  integer = false,
) {
  if (
    !Number.isFinite(value) ||
    value < min ||
    value > max ||
    (integer && !Number.isInteger(value))
  ) {
    throw new Error(
      `${label}必须在 ${min} 到 ${max} 之间${integer ? "且为整数" : ""}`,
    );
  }
  return value;
}

export function isMiniMaxSpeechModel(
  value: string,
): value is MiniMaxSpeechModelId {
  return (MINIMAX_SPEECH_MODEL_IDS as readonly string[]).includes(
    String(value || "").trim(),
  );
}

export function createMiniMaxCloneVoiceId(
  now = Date.now(),
  randomPart = crypto.randomUUID().replace(/-/g, "").slice(0, 8),
) {
  const safeRandom =
    String(randomPart)
      .replace(/[^A-Za-z0-9_-]/g, "")
      .replace(/[-_]+$/g, "")
      .slice(0, 32) || "voice001";
  return `CanvasVoice_${Math.max(0, Math.trunc(now))}_${safeRandom}`;
}

export function buildMiniMaxSpeechRequest(input: MiniMaxSpeechSettings) {
  const text = String(input.text || "").trim();
  const voiceId = String(input.voiceId || "").trim();
  if (!isMiniMaxSpeechModel(input.model))
    throw new Error("不支持的 MiniMax 语音模型");
  if (!text) throw new Error("请输入要合成的文本");
  if (text.length > MINIMAX_SPEECH_TEXT_MAX_LENGTH) {
    throw new Error(
      `合成文本不能超过 ${MINIMAX_SPEECH_TEXT_MAX_LENGTH} 个字符`,
    );
  }
  if (!voiceId) throw new Error("请选择音色");
  validateMiniMaxSpeechPauses(text);
  if (input.emotion && !getMiniMaxSpeechCapabilities(input.model).emotions.some((value) => value === input.emotion)) {
    throw new Error("当前模型不支持此情绪");
  }

  const speed = finiteNumber("语速", input.speed, 0.5, 2);
  const pitch = finiteNumber("声调", input.pitch, -12, 12, true);
  const volume = finiteNumber("音量", input.volume, 0.01, 10);
  const modifyPitch = finiteNumber("音高", input.modifyPitch, -100, 100, true);
  const modifyIntensity = finiteNumber(
    "强度",
    input.modifyIntensity,
    -100,
    100,
    true,
  );
  const modifyTimbre = finiteNumber(
    "音色调节",
    input.modifyTimbre,
    -100,
    100,
    true,
  );
  if (
    !MINIMAX_SPEECH_SOUND_EFFECTS.some(
      (effect) => effect.value === input.soundEffect,
    )
  ) {
    throw new Error("不支持的音效");
  }

  return {
    endpoint: "/v1/t2a_v2",
    body: {
      model: input.model,
      text,
      stream: false,
      language_boost: "auto",
      output_format: "url",
      voice_setting: {
        voice_id: voiceId,
        speed,
        vol: volume,
        pitch,
        ...(input.emotion ? { emotion: input.emotion } : {}),
      },
      audio_setting: {
        sample_rate: 32000,
        bitrate: 128000,
        format: "mp3",
        channel: 1,
      },
      voice_modify: {
        pitch: modifyPitch,
        intensity: modifyIntensity,
        timbre: modifyTimbre,
        ...(input.soundEffect ? { sound_effects: input.soundEffect } : {}),
      },
      subtitle_enable: false,
    },
  };
}

export function buildMiniMaxVoiceCloneRequest(
  input: MiniMaxVoiceCloneSettings,
) {
  const voiceId = String(input.voiceId || "").trim();
  const previewText = String(input.previewText || "").trim();
  if (!Number.isSafeInteger(input.fileId) || input.fileId < 1)
    throw new Error("音色文件 ID 无效");
  if (!isMiniMaxSpeechModel(input.model))
    throw new Error("不支持的 MiniMax 语音模型");
  if (!/^[A-Za-z][A-Za-z0-9_-]{6,254}[A-Za-z0-9]$/.test(voiceId)) {
    throw new Error(
      "音色 ID 需为 8-256 位，以英文字母开头，仅含字母、数字、-、_，且不能以 - 或 _ 结尾",
    );
  }
  if (previewText.length > 1_000)
    throw new Error("试听文本不能超过 1000 个字符");

  return {
    filePurpose: "voice_clone" as const,
    endpoint: "/v1/voice_clone",
    body: {
      file_id: input.fileId,
      voice_id: voiceId,
      ...(previewText
        ? {
            text: previewText,
            model: input.model,
            language_boost: "auto" as const,
          }
        : {}),
      need_noise_reduction: Boolean(input.needNoiseReduction),
      need_volume_normalization: Boolean(input.needVolumeNormalization),
    },
  };
}
