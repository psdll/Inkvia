export type SeedanceMediaKind = "image" | "video" | "audio";

export type SeedanceMediaProbe = {
  version: 1;
  kind: SeedanceMediaKind;
  detectedMime: string;
  container?: string;
  width?: number;
  height?: number;
  durationSeconds?: number;
  frameRate?: number;
  videoCodec?: string;
  audioCodecs?: string[];
  frameCount?: number;
};

export type SeedanceMediaIssue = {
  code: string;
  message: string;
  mediaId?: string;
  fileName?: string;
  actual?: string | number;
  expected?: string;
};

type NumericRange = {
  min: number;
  max: number;
};

type SeedanceFilePolicy = {
  mimeTypes: readonly string[];
  extensions: readonly string[];
  maxBytes: number;
  durationSeconds?: NumericRange;
};

type SeedanceVisualPolicy = SeedanceFilePolicy & {
  dimensions: NumericRange;
  aspectRatio: NumericRange;
};

export type SeedanceMediaPolicy = {
  ruleFamily: "seedance-1.0" | "seedance-1.5" | "seedance-2.0" | "seedance-2.5";
  allowedKinds: readonly SeedanceMediaKind[];
  allowRealPersonFace: boolean;
  image: SeedanceVisualPolicy;
  video: SeedanceVisualPolicy & {
    containers: readonly string[];
    pixelCount: NumericRange;
    frameRate: NumericRange;
    codecs: readonly string[];
    editDurationSeconds?: NumericRange;
  };
  audio: SeedanceFilePolicy & {
    containers: readonly string[];
    codecs: readonly string[];
  };
  limits: {
    maxImages: number;
    maxVideos: number;
    maxAudios: number;
    maxTotal: number;
    maxTimedMediaDurationSeconds?: number;
    allowStandaloneAudio: boolean;
  };
};

export type SeedanceMediaFileInput = {
  modelId: string;
  mediaId?: string;
  fileName?: string;
  byteSize: number;
  probe: SeedanceMediaProbe;
  taskType?: "auto" | "edit" | "extend";
};

export type SeedanceMediaSetInput = {
  modelId: string;
  media: Omit<SeedanceMediaFileInput, "modelId" | "taskType">[];
  taskType?: "auto" | "edit" | "extend";
};

const MIB = 1024 * 1024;

const COMMON_IMAGE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/bmp",
  "image/tiff",
  "image/gif",
] as const;

const MODERN_IMAGE_MIME_TYPES = [
  ...COMMON_IMAGE_MIME_TYPES,
  "image/heic",
  "image/heif",
] as const;

const IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "webp", "bmp", "tif", "tiff", "gif"] as const;
const MODERN_IMAGE_EXTENSIONS = [...IMAGE_EXTENSIONS, "heic", "heif"] as const;
const VIDEO_MIME_TYPES = ["video/mp4", "video/quicktime"] as const;
const VIDEO_EXTENSIONS = ["mp4", "mov"] as const;
const AUDIO_MIME_TYPES = [
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
  "audio/wave",
  "audio/vnd.wave",
] as const;
const AUDIO_EXTENSIONS = ["mp3", "wav"] as const;

const COMMON_IMAGE_POLICY: SeedanceVisualPolicy = {
  mimeTypes: COMMON_IMAGE_MIME_TYPES,
  extensions: IMAGE_EXTENSIONS,
  maxBytes: 30 * MIB,
  dimensions: { min: 300, max: 6000 },
  aspectRatio: { min: 0.4, max: 2.5 },
};

const MODERN_IMAGE_POLICY: SeedanceVisualPolicy = {
  ...COMMON_IMAGE_POLICY,
  mimeTypes: MODERN_IMAGE_MIME_TYPES,
  extensions: MODERN_IMAGE_EXTENSIONS,
};

const VIDEO_POLICY_15_SECONDS: SeedanceMediaPolicy["video"] = {
  mimeTypes: VIDEO_MIME_TYPES,
  extensions: VIDEO_EXTENSIONS,
  containers: ["mp4", "mov"],
  maxBytes: 200 * MIB,
  dimensions: { min: 300, max: 6000 },
  aspectRatio: { min: 0.4, max: 2.5 },
  pixelCount: { min: 407_696, max: 8_295_044 },
  durationSeconds: { min: 2, max: 15 },
  frameRate: { min: 24, max: 60 },
  codecs: ["h264", "h265"],
};

const AUDIO_POLICY_15_SECONDS: SeedanceMediaPolicy["audio"] = {
  mimeTypes: AUDIO_MIME_TYPES,
  extensions: AUDIO_EXTENSIONS,
  containers: ["mp3", "wav"],
  codecs: ["mp3", "pcm"],
  maxBytes: 15 * MIB,
  durationSeconds: { min: 2, max: 15 },
};

const BASE_POLICIES: Record<SeedanceMediaPolicy["ruleFamily"], SeedanceMediaPolicy> = {
  "seedance-1.0": {
    ruleFamily: "seedance-1.0",
    allowedKinds: ["image"],
    allowRealPersonFace: false,
    image: COMMON_IMAGE_POLICY,
    video: VIDEO_POLICY_15_SECONDS,
    audio: AUDIO_POLICY_15_SECONDS,
    limits: {
      maxImages: 2,
      maxVideos: 0,
      maxAudios: 0,
      maxTotal: 2,
      allowStandaloneAudio: false,
    },
  },
  "seedance-1.5": {
    ruleFamily: "seedance-1.5",
    allowedKinds: ["image"],
    allowRealPersonFace: false,
    image: MODERN_IMAGE_POLICY,
    video: VIDEO_POLICY_15_SECONDS,
    audio: AUDIO_POLICY_15_SECONDS,
    limits: {
      maxImages: 2,
      maxVideos: 0,
      maxAudios: 0,
      maxTotal: 2,
      allowStandaloneAudio: false,
    },
  },
  "seedance-2.0": {
    ruleFamily: "seedance-2.0",
    allowedKinds: ["image", "video", "audio"],
    allowRealPersonFace: false,
    image: MODERN_IMAGE_POLICY,
    video: VIDEO_POLICY_15_SECONDS,
    audio: AUDIO_POLICY_15_SECONDS,
    limits: {
      maxImages: 9,
      maxVideos: 3,
      maxAudios: 3,
      maxTotal: 15,
      maxTimedMediaDurationSeconds: 15,
      allowStandaloneAudio: false,
    },
  },
  "seedance-2.5": {
    ruleFamily: "seedance-2.5",
    allowedKinds: ["image", "video", "audio"],
    allowRealPersonFace: false,
    image: MODERN_IMAGE_POLICY,
    video: {
      ...VIDEO_POLICY_15_SECONDS,
      durationSeconds: { min: 2, max: 30 },
      editDurationSeconds: { min: 4, max: 30 },
    },
    audio: {
      ...AUDIO_POLICY_15_SECONDS,
      durationSeconds: { min: 2, max: 30 },
    },
    limits: {
      maxImages: 30,
      maxVideos: 10,
      maxAudios: 10,
      maxTotal: 50,
      maxTimedMediaDurationSeconds: 30,
      allowStandaloneAudio: true,
    },
  },
};

const MODEL_BINDINGS: Record<
  string,
  { ruleFamily: SeedanceMediaPolicy["ruleFamily"]; allowRealPersonFace?: boolean }
> = {
  "doubao-seedance-2-5-260628": { ruleFamily: "seedance-2.5" },
  "seedance-2.5-apimart": { ruleFamily: "seedance-2.5" },
  "doubao-seedance-2-0-260128": { ruleFamily: "seedance-2.0" },
  "doubao-seedance-2-0-fast-260128": { ruleFamily: "seedance-2.0" },
  "doubao-seedance-2-0-mini-260615": { ruleFamily: "seedance-2.0" },
  "doubao-seedance-2.0-face": {
    ruleFamily: "seedance-2.0",
    allowRealPersonFace: true,
  },
  "doubao-seedance-2.0-fast-face": {
    ruleFamily: "seedance-2.0",
    allowRealPersonFace: true,
  },
  "doubao-seedance-1-5-pro-251215": { ruleFamily: "seedance-1.5" },
  "doubao-seedance-1-0-pro-250528": { ruleFamily: "seedance-1.0" },
};

export function getSeedanceMediaPolicy(modelId: string): SeedanceMediaPolicy | undefined {
  const binding = MODEL_BINDINGS[modelId.trim()];
  if (!binding) return undefined;

  const base = BASE_POLICIES[binding.ruleFamily];
  if (binding.allowRealPersonFace === undefined) return base;
  return { ...base, allowRealPersonFace: binding.allowRealPersonFace };
}

export function isSeedanceMediaPolicyModel(modelId: string): boolean {
  return Boolean(getSeedanceMediaPolicy(modelId));
}

export function modelAllowsRealPersonFace(modelId: string): boolean {
  return getSeedanceMediaPolicy(modelId)?.allowRealPersonFace === true;
}

export function getSeedanceUploadContract(modelId: string): {
  allowedKinds: SeedanceMediaKind[];
  allowedMimeTypes: string[];
  allowedAudioMimeTypes: string[];
  maxBytes: Partial<Record<SeedanceMediaKind, number>>;
} | null {
  const policy = getSeedanceMediaPolicy(modelId);
  if (!policy) return null;

  return {
    allowedKinds: [...policy.allowedKinds],
    allowedMimeTypes: [
      ...policy.image.mimeTypes,
      ...policy.video.mimeTypes,
      ...policy.audio.mimeTypes,
    ],
    allowedAudioMimeTypes: [...policy.audio.mimeTypes],
    maxBytes: {
      image: policy.image.maxBytes,
      video: policy.video.maxBytes,
      audio: policy.audio.maxBytes,
    },
  };
}

function createIssue(
  input: SeedanceMediaFileInput,
  code: string,
  message: string,
  actual?: string | number,
  expected?: string,
): SeedanceMediaIssue {
  return {
    code,
    message,
    ...(input.mediaId ? { mediaId: input.mediaId } : {}),
    ...(input.fileName ? { fileName: input.fileName } : {}),
    ...(actual !== undefined ? { actual } : {}),
    ...(expected ? { expected } : {}),
  };
}

function isInRange(value: number, range: NumericRange): boolean {
  return value >= range.min && value <= range.max;
}

function formatDurationSeconds(value: number): string {
  return value.toFixed(3);
}

function formatDurationDifference(value: number): string {
  return value > 0 && value < 0.001 ? "<0.001" : formatDurationSeconds(value);
}

export function describeVideoDurationOutOfRange(
  actual: number,
  min: number,
  max: number,
): string {
  if (actual > max) {
    return `视频实际时长 ${formatDurationSeconds(actual)} 秒，超过模型上限 ${formatDurationDifference(actual - max)} 秒；允许范围为 ${min}–${max} 秒。`;
  }
  if (actual < min) {
    return `视频实际时长 ${formatDurationSeconds(actual)} 秒，低于模型下限 ${formatDurationDifference(min - actual)} 秒；允许范围为 ${min}–${max} 秒。`;
  }
  return `视频时长必须在 ${min}–${max} 秒之间。`;
}

function normalizeVideoCodec(codec: string): string {
  const normalized = codec.trim().toLowerCase();
  if (["avc", "avc1", "h.264"].includes(normalized)) return "h264";
  if (["hevc", "hev1", "hvc1", "h.265"].includes(normalized)) return "h265";
  return normalized;
}

function normalizeAudioCodec(codec: string): string {
  const normalized = codec.trim().toLowerCase();
  return normalized.startsWith("pcm_") ? "pcm" : normalized;
}

function validateVisualDimensions(
  input: SeedanceMediaFileInput,
  policy: SeedanceVisualPolicy,
  prefix: "image" | "video",
): SeedanceMediaIssue[] {
  const { width, height } = input.probe;
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    return [
      createIssue(
        input,
        "media_probe_incomplete",
        "无法读取素材宽高，请重新上传或更换文件。",
      ),
    ];
  }

  const issues: SeedanceMediaIssue[] = [];
  if (!isInRange(width!, policy.dimensions) || !isInRange(height!, policy.dimensions)) {
    issues.push(
      createIssue(
        input,
        `${prefix}_dimension_out_of_range`,
        `素材宽高必须在 ${policy.dimensions.min}–${policy.dimensions.max} 像素之间。`,
        `${width}x${height}`,
        `${policy.dimensions.min}–${policy.dimensions.max}px`,
      ),
    );
  }

  const aspectRatio = width! / height!;
  if (!isInRange(aspectRatio, policy.aspectRatio)) {
    issues.push(
      createIssue(
        input,
        `${prefix}_aspect_ratio_out_of_range`,
        `素材宽高比必须在 ${policy.aspectRatio.min}–${policy.aspectRatio.max} 之间。`,
        Number(aspectRatio.toFixed(4)),
        `${policy.aspectRatio.min}–${policy.aspectRatio.max}`,
      ),
    );
  }
  return issues;
}

export function validateSeedanceMediaFile(input: SeedanceMediaFileInput): SeedanceMediaIssue[] {
  const policy = getSeedanceMediaPolicy(input.modelId);
  if (!policy) return [];

  const { probe } = input;
  const issues: SeedanceMediaIssue[] = [];
  if (!policy.allowedKinds.includes(probe.kind)) {
    return [
      createIssue(
        input,
        "media_kind_not_allowed",
        `当前模型不支持${probe.kind === "video" ? "视频" : probe.kind === "audio" ? "音频" : "图片"}参考素材。`,
      ),
    ];
  }

  if (probe.kind === "image") {
    if (!policy.image.mimeTypes.includes(probe.detectedMime)) {
      issues.push(createIssue(input, "image_format_unsupported", "图片格式不符合当前模型要求。"));
    }
    if (input.byteSize >= policy.image.maxBytes) {
      issues.push(
        createIssue(input, "image_file_too_large", "图片文件必须小于 30MB。", input.byteSize, "<30MB"),
      );
    }
    issues.push(...validateVisualDimensions(input, policy.image, "image"));
    return issues;
  }

  if (probe.kind === "video") {
    if (!policy.video.mimeTypes.includes(probe.detectedMime)) {
      issues.push(createIssue(input, "video_format_unsupported", "视频容器必须是 MP4 或 MOV。"));
    }
    const container = probe.container?.trim().toLowerCase();
    if (!container || !policy.video.containers.some((item) => container.includes(item))) {
      issues.push(createIssue(input, "video_container_unsupported", "视频容器必须是 MP4 或 MOV。"));
    }
    if (input.byteSize > policy.video.maxBytes) {
      issues.push(
        createIssue(input, "video_file_too_large", "视频文件不能超过 200MB。", input.byteSize, "<=200MB"),
      );
    }
    issues.push(...validateVisualDimensions(input, policy.video, "video"));
    if (Number.isFinite(probe.width) && Number.isFinite(probe.height)) {
      const pixels = probe.width! * probe.height!;
      if (!isInRange(pixels, policy.video.pixelCount)) {
        issues.push(
          createIssue(
            input,
            "video_pixel_count_out_of_range",
            `视频总像素必须在 ${policy.video.pixelCount.min}–${policy.video.pixelCount.max} 之间。`,
            pixels,
            `${policy.video.pixelCount.min}–${policy.video.pixelCount.max}`,
          ),
        );
      }
    }
    const durationRange =
      input.taskType === "edit" && policy.video.editDurationSeconds
        ? policy.video.editDurationSeconds
        : policy.video.durationSeconds;
    if (!Number.isFinite(probe.durationSeconds)) {
      issues.push(createIssue(input, "media_probe_incomplete", "无法读取视频时长，请重新上传或更换文件。"));
    } else if (durationRange && !isInRange(probe.durationSeconds!, durationRange)) {
      issues.push(
        createIssue(
          input,
          "video_duration_out_of_range",
          describeVideoDurationOutOfRange(
            probe.durationSeconds!,
            durationRange.min,
            durationRange.max,
          ),
          probe.durationSeconds,
          `${durationRange.min}–${durationRange.max}s`,
        ),
      );
    }
    if (!Number.isFinite(probe.frameRate)) {
      issues.push(createIssue(input, "media_probe_incomplete", "无法读取视频帧率，请重新上传或更换文件。"));
    } else if (!isInRange(probe.frameRate!, policy.video.frameRate)) {
      issues.push(
        createIssue(
          input,
          "video_frame_rate_out_of_range",
          `视频帧率必须在 ${policy.video.frameRate.min}–${policy.video.frameRate.max} FPS 之间。`,
          probe.frameRate,
          `${policy.video.frameRate.min}–${policy.video.frameRate.max} FPS`,
        ),
      );
    }
    const codec = probe.videoCodec ? normalizeVideoCodec(probe.videoCodec) : "";
    if (!codec || !policy.video.codecs.includes(codec)) {
      issues.push(createIssue(input, "video_codec_unsupported", "视频编码必须是 H.264 或 H.265。", codec));
    }
    return issues;
  }

  if (!policy.audio.mimeTypes.includes(probe.detectedMime)) {
    issues.push(createIssue(input, "audio_format_unsupported", "音频格式必须是 MP3 或 WAV。"));
  }
  const container = probe.container?.trim().toLowerCase();
  if (!container || !policy.audio.containers.some((item) => container.includes(item))) {
    issues.push(createIssue(input, "audio_container_unsupported", "音频格式必须是 MP3 或 WAV。"));
  }
  if (input.byteSize > policy.audio.maxBytes) {
    issues.push(
      createIssue(input, "audio_file_too_large", "音频文件不能超过 15MB。", input.byteSize, "<=15MB"),
    );
  }
  if (!Number.isFinite(probe.durationSeconds)) {
    issues.push(createIssue(input, "media_probe_incomplete", "无法读取音频时长，请重新上传或更换文件。"));
  } else if (policy.audio.durationSeconds && !isInRange(probe.durationSeconds!, policy.audio.durationSeconds)) {
    issues.push(
      createIssue(
        input,
        "audio_duration_out_of_range",
        `音频时长必须在 ${policy.audio.durationSeconds.min}–${policy.audio.durationSeconds.max} 秒之间。`,
        probe.durationSeconds,
        `${policy.audio.durationSeconds.min}–${policy.audio.durationSeconds.max}s`,
      ),
    );
  }
  const unsupportedAudioCodec = (probe.audioCodecs ?? [])
    .map(normalizeAudioCodec)
    .find((codec) => !policy.audio.codecs.includes(codec));
  if (!probe.audioCodecs?.length || unsupportedAudioCodec) {
    issues.push(
      createIssue(
        input,
        "audio_codec_unsupported",
        "音频编码必须与 MP3 或 WAV 格式匹配。",
        unsupportedAudioCodec,
      ),
    );
  }
  return issues;
}

export function validateSeedanceMediaSet(input: SeedanceMediaSetInput): SeedanceMediaIssue[] {
  const policy = getSeedanceMediaPolicy(input.modelId);
  if (!policy) return [];

  const issues = input.media.flatMap((media) =>
    validateSeedanceMediaFile({ ...media, modelId: input.modelId, taskType: input.taskType }),
  );
  const counts = input.media.reduce(
    (result, media) => {
      result[media.probe.kind] += 1;
      return result;
    },
    { image: 0, video: 0, audio: 0 } satisfies Record<SeedanceMediaKind, number>,
  );

  const countChecks: Array<[number, number, string, string]> = [
    [counts.image, policy.limits.maxImages, "too_many_images", `图片不能超过 ${policy.limits.maxImages} 张。`],
    [counts.video, policy.limits.maxVideos, "too_many_videos", `视频不能超过 ${policy.limits.maxVideos} 个。`],
    [counts.audio, policy.limits.maxAudios, "too_many_audios", `音频不能超过 ${policy.limits.maxAudios} 个。`],
    [input.media.length, policy.limits.maxTotal, "too_many_media", `参考素材合计不能超过 ${policy.limits.maxTotal} 个。`],
  ];
  for (const [actual, maximum, code, message] of countChecks) {
    if (actual > maximum) issues.push({ code, message, actual, expected: `<=${maximum}` });
  }

  if (
    counts.audio > 0 &&
    counts.image === 0 &&
    counts.video === 0 &&
    !policy.limits.allowStandaloneAudio
  ) {
    issues.push({
      code: "standalone_audio_not_allowed",
      message: "音频不能作为唯一参考素材，请同时添加图片或视频。",
    });
  }

  if (policy.limits.maxTimedMediaDurationSeconds !== undefined) {
    for (const kind of ["video", "audio"] as const) {
      const totalDuration = input.media.reduce((sum, media) => {
        if (media.probe.kind !== kind) return sum;
        return sum + (media.probe.durationSeconds ?? 0);
      }, 0);
      if (totalDuration > policy.limits.maxTimedMediaDurationSeconds) {
        issues.push({
          code: `${kind}_total_duration_too_long`,
          message: `${kind === "video" ? "视频" : "音频"}总时长不能超过 ${policy.limits.maxTimedMediaDurationSeconds} 秒。`,
          actual: Number(totalDuration.toFixed(3)),
          expected: `<=${policy.limits.maxTimedMediaDurationSeconds}s`,
        });
      }
    }
  }

  return issues;
}
