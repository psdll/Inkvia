// How each model platform receives local reference media (images, videos, audio).
// Client-safe: the admin storage page renders this table directly.

export type MediaKind = "image" | "video" | "audio";

/**
 * platform-upload : the platform's own upload returns a URL or an internal file reference.
 * inline-base64   : the file is embedded in the request as a data URL; nothing is hosted.
 * local-inline    : the adapter already reads the local file itself (no hosting needed).
 * oss             : the platform offers no temporary hosting; the project's Aliyun OSS relays the file.
 */
export type MediaDeliveryMethod = "platform-upload" | "inline-base64" | "local-inline" | "oss";

export type MediaDeliveryMode = "platform" | "oss";

export type PlatformDeliveryEntry = {
  id: string;
  name: string;
  methods: Partial<Record<MediaKind, MediaDeliveryMethod>>;
  /** Shown next to platform-hosted kinds. */
  retention?: string;
  /** Why media goes this way; for OSS rows, why the platform cannot host it. */
  note: string;
};

export const MEDIA_DELIVERY_PLATFORMS: readonly PlatformDeliveryEntry[] = [
  {
    id: "kie",
    name: "KIE.AI",
    methods: { image: "platform-upload", video: "platform-upload", audio: "platform-upload" },
    retention: "24 小时后自动删除",
    note: "使用 KIE 官方文件流式上传（kieai.redpandaai.co），供 KIE 模型使用，上传免费。",
  },
  {
    id: "apimart",
    name: "APIMART",
    methods: { image: "platform-upload", video: "platform-upload", audio: "platform-upload" },
    retention: "保留 3 天",
    note: "使用 APIMart 官方图片、视频、音频上传。3 天档的免费次数按账户配额，图片、视频、音频共享。",
  },
  {
    id: "bailian",
    name: "阿里云百炼官方",
    methods: { image: "platform-upload", video: "platform-upload", audio: "platform-upload" },
    retention: "48 小时后自动删除",
    note: "使用百炼免费临时存储（oss://dashscope-instant），文件与调用的模型绑定。",
  },
  {
    id: "volcengine",
    name: "火山引擎官方（Seedream / Seedance）",
    methods: { image: "inline-base64", video: "platform-upload", audio: "inline-base64" },
    note: "Seedream / Seedance 图片和 Seedance 的 WAV、MP3 参考音频可 Base64 直传。Seedance 本机参考视频优先用方舟 Files 的临时链接（24 小时），上传或链接预检失败时回退 OSS。视频理解可使用方舟文件 ID。",
  },
  {
    id: "minimax",
    name: "MiniMax",
    methods: { image: "inline-base64", video: "platform-upload", audio: "platform-upload" },
    retention: "视频生成文件保留 7 天",
    note: "H3 较小的 MP4、MP3、WAV 以 Base64 发送，MOV 或较大的视频、音频用原生文件上传（mm_file://）。",
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    methods: { image: "inline-base64", video: "inline-base64", audio: "inline-base64" },
    note: "OpenRouter 支持 Base64 输入，不需要图床。",
  },
  {
    id: "google-ai-studio",
    name: "Google AI Studio",
    methods: { image: "local-inline" },
    note: "直接读取本地文件随请求发送，不需要图床。",
  },
  {
    id: "tuzi",
    name: "兔子 API",
    methods: { image: "local-inline" },
    note: "直接读取本地文件随请求发送，不需要图床。",
  },
  {
    id: "bigmodel",
    name: "智谱 BigModel 官方",
    methods: { image: "inline-base64" },
    note: "视觉模型的图片以 Base64 随请求发送，不需要图床。",
  },
  {
    id: "volcengine-speech",
    name: "火山引擎语音官方",
    methods: { image: "local-inline", audio: "local-inline" },
    note: "Seed Audio 直接读取本机图片或音频。语音识别直接发送音频数据，普通语音合成只需要文本。",
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    methods: { image: "inline-base64" },
    note: "Flash 视觉能力以具体模型为准，支持 Base64 图片及图片 Files API。Pro 只接收文本。",
  },
  {
    id: "volcengine-mediakit",
    name: "火山引擎 AI MediaKit 官方",
    methods: { video: "platform-upload" },
    retention: "保留 30 天",
    note: "去字幕优先走 MediaKit 自带上传（mediakit://），失败回退到阿里云 OSS。上传和存储目前免费。",
  },
  {
    id: "aicoming-haiya",
    name: "海牙科技（AIComing）",
    methods: { image: "oss" },
    note: "没有找到该平台的临时上传或 Base64 说明，走阿里云 OSS。",
  },
  {
    id: "work-fisher",
    name: "FisherAI",
    methods: { image: "platform-upload" },
    retention: "保留 24 小时",
    note: "Qwen Image Global 2.1 通过 Fisher 自带上传取得参考图 URL，支持 JPEG、PNG、WebP，单文件不超过 50 MB。",
  },
  {
    id: "jiekou",
    name: "接口AI",
    methods: { image: "oss" },
    note: "项目保留的旧图像编辑接口使用公开图片 URL。当前官方文档的 multipart 是另一个接口。",
  },
  {
    id: "reapi",
    name: "reAPI",
    methods: { image: "oss" },
    note: "项目的参考图接口要求可公开下载的 URL，官方明确拒绝 Base64 data URI。",
  },
] as const;

/** LLM image understanding: chat platforms whose OpenAI-compatible API accepts Base64 images. */
export const LLM_INLINE_IMAGE_PLATFORMS: readonly string[] = [
  "openrouter", "bigmodel", "bailian", "volcengine", "minimax", "google-ai-studio", "apimart", "kie",
];

/** Platforms the code supports but that have no researched hosting; everything goes through OSS. */
export const OSS_ONLY_FALLBACK_NOTE = "该平台没有接入临时图床，走阿里云 OSS。";

const byId = new Map(MEDIA_DELIVERY_PLATFORMS.map((entry) => [entry.id, entry]));

export function getPlatformDeliveryEntry(platformId: string): PlatformDeliveryEntry | undefined {
  return byId.get(platformId);
}

/** The method used for this platform and kind when the switch is on "platform". Unknown → OSS. */
export function platformDeliveryMethod(platformId: string, kind: MediaKind): MediaDeliveryMethod {
  return byId.get(platformId)?.methods[kind] ?? "oss";
}

export function inferMediaKind(pathOrName: string): MediaKind {
  const ext = String(pathOrName || "").toLowerCase().split("?")[0].split(".").pop() || "";
  if (["mp4", "mov", "webm", "m4v", "mkv", "avi", "mpeg"].includes(ext)) return "video";
  if (["mp3", "wav", "m4a", "aac", "ogg", "opus", "flac", "pcm"].includes(ext)) return "audio";
  return "image";
}
