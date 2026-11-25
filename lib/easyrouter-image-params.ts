export const EASYROUTER_IMAGE_2_ASPECT_RATIOS = [
  "1:1",
  "3:4",
  "4:3",
  "9:16",
  "16:9",
] as const;

export const EASYROUTER_IMAGE_2_RESOLUTIONS = ["1K", "2K", "4K"] as const;

type EasyRouterImage2AspectRatio = (typeof EASYROUTER_IMAGE_2_ASPECT_RATIOS)[number];
type EasyRouterImage2Resolution = (typeof EASYROUTER_IMAGE_2_RESOLUTIONS)[number];

const EASYROUTER_IMAGE_2_SIZE_PRESETS: Record<
  EasyRouterImage2Resolution,
  Record<EasyRouterImage2AspectRatio, string>
> = {
  "1K": {
    "1:1": "1024x1024",
    "3:4": "768x1024",
    "4:3": "1024x768",
    "9:16": "720x1280",
    "16:9": "1280x720",
  },
  "2K": {
    "1:1": "2048x2048",
    "3:4": "1536x2048",
    "4:3": "2048x1536",
    "9:16": "1152x2048",
    "16:9": "2048x1152",
  },
  "4K": {
    "1:1": "2880x2880",
    "3:4": "2448x3264",
    "4:3": "3264x2448",
    "9:16": "2160x3840",
    "16:9": "3840x2160",
  },
};

function clean(value: unknown) {
  return String(value || "").trim();
}

function parseCustomSize(value: unknown) {
  const match = /^(\d{2,5})\s*[x×]\s*(\d{2,5})$/i.exec(clean(value));
  if (!match) return null;
  return { width: Number(match[1]), height: Number(match[2]) };
}

function isResolution(value: string): value is EasyRouterImage2Resolution {
  return (EASYROUTER_IMAGE_2_RESOLUTIONS as readonly string[]).includes(value);
}

function isAspectRatio(value: string): value is EasyRouterImage2AspectRatio {
  return (EASYROUTER_IMAGE_2_ASPECT_RATIOS as readonly string[]).includes(value);
}

export function getEasyRouterCustomSizeError(value: unknown) {
  const size = parseCustomSize(value);
  if (!size) return "自定义尺寸请输入宽 x 高，例如 1024x1024";

  const { width, height } = size;
  if (width % 16 !== 0 || height % 16 !== 0) {
    return "自定义尺寸的宽和高必须是 16 的倍数";
  }
  if (Math.max(width, height) > 3840) {
    return "自定义尺寸的单边不能超过 3840";
  }
  if (Math.max(width / height, height / width) > 3) {
    return "自定义尺寸比例必须在 1:3 到 3:1 之间";
  }

  const pixels = width * height;
  if (pixels < 655_360 || pixels > 8_294_400) {
    return "自定义尺寸总像素必须在 655360 到 8294400 之间";
  }
  return null;
}

export function mapEasyRouterGptImage2Size(input: {
  aspectRatio?: string;
  resolution?: string;
  customSize?: string;
}) {
  const aspectRatio = clean(input.aspectRatio);
  if (aspectRatio === "custom") {
    const error = getEasyRouterCustomSizeError(input.customSize);
    if (error) throw new Error(error);
    const size = parseCustomSize(input.customSize)!;
    return `${size.width}x${size.height}`;
  }

  const resolution = clean(input.resolution).toUpperCase();
  const safeResolution = isResolution(resolution) ? resolution : "2K";
  const safeAspectRatio = isAspectRatio(aspectRatio) ? aspectRatio : "1:1";
  return EASYROUTER_IMAGE_2_SIZE_PRESETS[safeResolution][safeAspectRatio];
}
