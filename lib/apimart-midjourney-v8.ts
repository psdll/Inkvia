import { requestJsonViaProxy, resolveApimartEndpoint } from "@/lib/apimart-image";
import { DEFAULT_MIDJOURNEY_VERSION, midjourneyVersionCapabilities, normalizeMidjourneyV8Ratio, normalizeMidjourneyV8Speed, type MidjourneyV8Options } from "@/lib/midjourney-v8";

// https://docs.apimart.ai/cn/api-reference/images/midjourney/{imagine,edits}
// Advanced fields are sent only when set, so a plain request stays identical to before.
export function buildApimartMidjourneyV8Request(input: {
  prompt: unknown;
  aspectRatio?: unknown;
  speed?: unknown;
  imageUrls?: unknown;
  options?: MidjourneyV8Options;
}) {
  const imageUrls = Array.isArray(input.imageUrls)
    ? Array.from(new Set(input.imageUrls.map(value => String(value ?? "").trim()).filter(Boolean)))
    : [];
  if (imageUrls.some(url => !/^https?:\/\//i.test(url))) {
    throw new Error("Midjourney V8.2 参考图必须是公开 HTTP(S) URL");
  }
  const baseOptions = input.options ?? {};
  // 有参考图时默认按提示词改写原图（edits）；“垫图参考”走 imagine 的 image_urls；
  // “风格参考”把参考图当作 sref，只借风格不借内容。
  const styleReference = imageUrls.length > 0 && baseOptions.referenceMode === "style";
  const options: MidjourneyV8Options = styleReference
    ? { ...baseOptions, sref: [baseOptions.sref, ...imageUrls].filter(Boolean).join(" ") }
    : baseOptions;
  const contentImages = styleReference ? [] : imageUrls;
  const version = options.version ?? DEFAULT_MIDJOURNEY_VERSION;
  // 改写原图（edits）只有 V8.x 支持；其他版本有参考图时按垫图参考提交
  const canEdit = midjourneyVersionCapabilities(version).edits;
  const action = contentImages.length && options.referenceMode !== "imagine" && canEdit ? "edits" : "imagine";
  const advanced = {
    ...(options.stylize !== undefined ? { stylize: options.stylize } : {}),
    ...(options.chaos !== undefined ? { chaos: options.chaos } : {}),
    ...(options.weird !== undefined ? { weird: options.weird } : {}),
    ...(options.seed !== undefined ? { seed: options.seed } : {}),
    ...(options.negativePrompt ? { negative_prompt: options.negativePrompt } : {}),
    ...(options.quality ? { quality: options.quality } : {}),
    // V8.2 的原始风格只能用 raw: true，不能用 style: "raw"
    ...(options.raw ? { raw: true } : {}),
    ...(options.hd ? { hd: true } : {}),
    ...(options.draft ? { draft: true } : {}),
    ...(options.tile ? { tile: true } : {}),
    ...(options.sref ? { sref: options.sref } : {}),
    ...(options.sref && options.sw !== undefined ? { sw: options.sw } : {}),
    ...(contentImages.length && action === "imagine" && options.iw !== undefined ? { iw: options.iw } : {}),
    ...(options.cref ? { cref: options.cref } : {}),
    ...(options.cref && options.cw !== undefined ? { cw: options.cw } : {}),
    ...(options.stop !== undefined ? { stop: options.stop } : {}),
    ...(options.extra ? { extra: options.extra } : {}),
  };
  // Niji 走 version 7/6 + niji: true（APIMart 计费归一化为 niji7/niji6）
  const versionFields = version.startsWith("niji ") ? { version: version.slice(5), niji: true } : { version };
  return {
    endpoint: action === "edits" ? "/midjourney/generations/edits" : "/midjourney/generations",
    action,
    body: {
      prompt: String(input.prompt ?? "").trim(),
      ...versionFields,
      size: normalizeMidjourneyV8Ratio(input.aspectRatio),
      speed: normalizeMidjourneyV8Speed(input.speed),
      ...(contentImages.length ? { image_urls: contentImages } : {}),
      ...advanced,
    },
  };
}

export async function apimartSubmitMidjourneyV8(input: Parameters<typeof buildApimartMidjourneyV8Request>[0]) {
  const { base, apiKey, decision } = await resolveApimartEndpoint();
  const request = buildApimartMidjourneyV8Request(input);
  const data = await requestJsonViaProxy(decision, `${base}${request.endpoint}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(request.body),
    timeoutMs: 60000,
  });
  const taskId = String(data?.data?.[0]?.task_id || data?.data?.task_id || data?.task_id || "").trim();
  if (!taskId) throw new Error("APIMart 未返回异步任务 ID");
  return { taskId, raw: data, request: request.body, action: request.action };
}
