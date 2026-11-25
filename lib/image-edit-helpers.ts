import { VOLC_SEEDREAM_55_MODEL, VOLC_SEEDREAM_55_UPSTREAM } from "@/lib/volcengine-seedream-55";
// 图片编辑接口的纯工具函数。
// 从 app/api/image-edit/route.ts 抽出，便于路由聚焦于业务流程。

import { createHash } from "crypto";
import { resolveMediaForPlatform, type MediaDeliveryTarget } from "@/lib/media-delivery/deliver";
import { DOUBAO_SEEDREAM_5_LITE_MODEL, DOUBAO_SEEDREAM_5_PRO_MODEL } from "@/lib/toolbox-models";
import { directAxios, providerAxios } from "@/lib/providers/transport";

/** 按宽高比 + 分辨率 + 模型，映射出 Doubao-Seedream 的 size 参数 */
export function mapSeedreamSize(aspectRatio: string, resolution: string, model: string) {
  const isSeedreamPro = model === DOUBAO_SEEDREAM_5_PRO_MODEL;
  const isSeedreamLite = model === DOUBAO_SEEDREAM_5_LITE_MODEL;
  const isSeedream45 = model === "doubao-seedream-4.5";
  const r = isSeedreamPro
    ? resolution === "1K"
      ? "1K"
      : "2K"
    : isSeedreamLite
    ? resolution === "3K"
      ? "3K"
      : "2K"
    : isSeedream45
      ? resolution === "4K"
        ? "4K"
        : "2K"
      : resolution === "4K"
        ? "4K"
        : resolution === "1K"
          ? "1K"
          : "2K";
  const sizeMap: Record<string, Record<string, string>> = {
    "1K": {
      "1:1": "1024x1024",
      "3:4": "864x1152",
      "4:3": "1152x864",
      "16:9": "1424x800",
      "9:16": "800x1424",
      "3:2": "1248x832",
      "2:3": "832x1248",
      "21:9": "1568x672"
    },
    "2K": {
      "1:1": "2048x2048",
      "3:4": "1728x2304",
      "4:3": "2304x1728",
      "16:9": "2848x1600",
      "9:16": "1600x2848",
      "3:2": "2496x1664",
      "2:3": "1664x2496",
      "21:9": "3136x1344"
    },
    "3K": {
      "1:1": "3072x3072",
      "3:4": "2592x3456",
      "4:3": "3456x2592",
      "16:9": "4096x2304",
      "9:16": "2304x4096",
      "2:3": "2496x3744",
      "3:2": "3744x2496",
      "21:9": "4704x2016"
    },
    "4K": {
      "1:1": "4096x4096",
      "3:4": "3520x4704",
      "4:3": "4704x3520",
      "16:9": "5504x3040",
      "9:16": "3040x5504",
      "2:3": "3328x4992",
      "3:2": "4992x3328",
      "21:9": "6240x2656"
    }
  };
  return sizeMap[r][aspectRatio] || (r === "4K" ? "4096x4096" : r === "3K" ? "3072x3072" : r === "1K" ? "1024x1024" : "2048x2048");
}

/** 把 UI 用的模型别名映射为 Seedream 的实际模型 ID */
export function mapSeedreamModelId(model: string) {
  if (model === VOLC_SEEDREAM_55_MODEL) return VOLC_SEEDREAM_55_UPSTREAM;
  if (model === DOUBAO_SEEDREAM_5_PRO_MODEL) return "doubao-seedream-5-0-pro-260628";
  if (model === DOUBAO_SEEDREAM_5_LITE_MODEL) return "doubao-seedream-5-0-260128";
  if (model === "doubao-seedream-4.5") return "doubao-seedream-4-5-251128";
  if (model === "doubao-seedream-4.0") return "doubao-seedream-4-0-250828";
  return "doubao-seedream-5-0-260128";
}

/** Legacy helper retained for old snapshots that stored pixel sizes. */
export function legacyGptImage2PixelSize(aspectRatio: string, resolution: string) {
  const [rawW, rawH] = String(aspectRatio || "1:1").split(":");
  const aspectW = Number(rawW);
  const aspectH = Number(rawH);
  const ratio = aspectW > 0 && aspectH > 0 ? aspectW / aspectH : 1;
  const targetPixels =
    resolution === "4K"
      ? 3840 * 2160
      : resolution === "2K"
        ? 2048 * 2048
        : 1024 * 1024;
  const maxEdge = 3840;
  const maxPixels = 3840 * 2160;
  let width = Math.sqrt(targetPixels * ratio);
  let height = width / ratio;
  const scale = Math.min(1, maxEdge / Math.max(width, height), Math.sqrt(maxPixels / (width * height)));
  width *= scale;
  height *= scale;
  let mappedWidth = Math.max(16, Math.floor(width / 16) * 16);
  let mappedHeight = Math.max(16, Math.floor(height / 16) * 16);
  while ((mappedWidth > maxEdge || mappedHeight > maxEdge || mappedWidth * mappedHeight > maxPixels) && mappedWidth > 16 && mappedHeight > 16) {
    if (mappedWidth >= mappedHeight) {
      mappedWidth -= 16;
    } else {
      mappedHeight -= 16;
    }
  }
  return `${mappedWidth}x${mappedHeight}`;
}

/** 系列图模式下追加数量约束到提示词 */
export function buildSeedreamPrompt(prompt: string, outputMode: "single" | "group", outputCount: number) {
  const base = String(prompt || "").trim();
  if (!base) return base;
  if (outputMode !== "group") return base;
  const count = Math.max(2, Number(outputCount) || 2);
  return `${base}\n\n请严格输出 ${count} 张相互关联、风格一致但内容有区分的图片；最终返回数量必须是 ${count} 张。如果原提示词中出现与数量相关的描述且和 ${count} 张不一致，以 ${count} 张为准。`;
}

/** 按 origin+pathname 去重 URL 列表 */
function dedupeUrls(urls: string[]) {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of urls) {
    const value = String(raw || "").trim();
    if (!value) continue;
    let key = value;
    try {
      const u = new URL(value);
      key = `${u.origin}${u.pathname}`;
    } catch {}
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

/** 先按 URL 去重，再下载内容按 sha256 去重（防同图不同 URL） */
export async function dedupeImageUrlsByContent(urls: string[], providerId?: string) {
  const byUrl = dedupeUrls(urls);
  if (byUrl.length <= 1) return byUrl;
  const out: string[] = [];
  const seenHash = new Set<string>();
  for (const url of byUrl) {
    try {
      const config = {
        url,
        method: "GET",
        responseType: "arraybuffer" as const,
        timeout: 30000,
        headers: {
          Accept: "*/*",
          "User-Agent": "Mozilla/5.0"
        }
      };
      const response = providerId
        ? await providerAxios<ArrayBuffer>(providerId, config, { purpose: "media" })
        : await directAxios<ArrayBuffer>({ ...config, maxRedirects: 3 }, { purpose: "media" });
      const buf = Buffer.from(response.data);
      const hash = createHash("sha256").update(buf).digest("hex");
      if (seenHash.has(hash)) continue;
      seenHash.add(hash);
      out.push(url);
    } catch {
      out.push(url);
    }
  }
  return out;
}

/** 把图片输入路径归一为可供外部 API 访问的公网 URL */
export async function mapImagePathToPublicUrl(imagePath: string, uploadFolder = "image-edit-inputs", target?: MediaDeliveryTarget | null) {
  const v = String(imagePath || "").trim();
  if (!v) return "";
  if (/^data:image\/[a-z0-9.+-]+;base64,/i.test(v)) return v;
  return resolveMediaForPlatform(v, uploadFolder, target, "image");
}
