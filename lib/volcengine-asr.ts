import "server-only";

import { randomUUID } from "node:crypto";
import { resolvedProviderApiKey } from "@/lib/providers/resolve";
import { fetchWithProviderEgress, resolveProviderRequestContext } from "@/lib/providers/transport";
import { providerErrorSensitiveValues, sanitizeProviderErrorText } from "@/lib/providers/error-safety";
import { getRegisteredProviders } from "@/lib/providers/registry";
import { isProviderModelEnabled } from "@/lib/providers/model-availability";
import { getVisibleToolboxModels } from "@/lib/image-edit-models";
import { VOLC_ASR_MODEL_ID, VOLC_ASR_PROVIDER_ID } from "@/lib/volcengine-asr-models";

/** 管理员在「API 配置」启用、且在「模型显示」没有隐藏时才可用 */
export async function isVolcAsrAvailable() {
  const [providers, visible] = await Promise.all([getRegisteredProviders(), getVisibleToolboxModels("audio")]);
  return isProviderModelEnabled(providers, "audio", VOLC_ASR_MODEL_ID) && visible.some(model => model.id === VOLC_ASR_MODEL_ID);
}

/**
 * 火山引擎豆包语音 · 大模型录音文件识别极速版：一次请求直接返回结果，不用 submit/query 轮询。
 * 与 Seed Audio 共用「火山引擎语音」平台的 API Key（新版控制台 X-Api-Key）。
 * 限制：单个音频不超过 2 小时、100MB，格式 WAV / MP3 / OGG OPUS。
 */
const FLASH_PATH = "/api/v3/auc/bigmodel/recognize/flash";
const FLASH_RESOURCE = "volc.bigasr.auc_turbo";
const SUCCESS = "20000000";
const SILENT = "20000003";
const PROCESSING = "20000001";
const QUEUED = "20000002";
const STANDARD_PATH = "/api/v3/auc/bigmodel";
export const VOLC_ASR_MAX_BYTES = 100_000_000;

export type TranscriptSegment = { start: number; end: number; text: string };
export type Transcript = { text: string; segments: TranscriptSegment[]; durationSeconds?: number };

type FlashResponse = {
  audio_info?: { duration?: number };
  result?: { text?: string; utterances?: { start_time?: number; end_time?: number; text?: string }[] };
};

export class VolcAsrError extends Error {
  constructor(message: string, readonly code: string) { super(message); }
}

type TranscribeInput = { data: Buffer; format: "mp3" | "wav" | "ogg"; requestId?: string; signal?: AbortSignal };

/**
 * 录音文件识别：优先用极速版（一次请求出结果）；账号没开通极速版时，自动改用已开通的
 * 标准版（2.0 → 1.0，提交后轮询，几秒出结果）。用过一次就记住哪个可用。
 */
const STANDARD_RESOURCES = ["volc.seedasr.auc", "volc.bigasr.auc"] as const;
let workingResource: string | null = null;

export async function transcribeAudio(input: TranscribeInput): Promise<Transcript> {
  if (!input.data.length) return { text: "", segments: [] };
  if (input.data.length > VOLC_ASR_MAX_BYTES) throw new VolcAsrError("音频超过 100MB，无法识别", "ASR_INPUT_TOO_LARGE");
  if (!await isVolcAsrAvailable()) throw new VolcAsrError("管理员未启用「豆包语音识别·极速版」", "ASR_MODEL_DISABLED");
  const configured = String(process.env.INKVIA_VOLC_ASR_RESOURCE_ID || "").trim();
  if (configured) return configured === FLASH_RESOURCE ? transcribeFlash(input) : transcribeStandard(input, configured);
  if (workingResource && workingResource !== FLASH_RESOURCE) return transcribeStandard(input, workingResource);
  try {
    const result = await transcribeFlash(input);
    workingResource = FLASH_RESOURCE;
    return result;
  } catch (error) {
    if (!(error instanceof VolcAsrError) || !/^4500003/.test(error.code)) throw error;
    let last: unknown = error;
    for (const resource of STANDARD_RESOURCES) {
      try {
        const result = await transcribeStandard(input, resource);
        workingResource = resource;
        return result;
      } catch (reason) {
        if (!(reason instanceof VolcAsrError) || !/^4500003/.test(reason.code)) throw reason;
        last = reason;
      }
    }
    throw last;
  }
}

function toTranscript(data: FlashResponse | null): Transcript {
  const segments = (data?.result?.utterances ?? [])
    .map(item => ({ start: (item.start_time ?? 0) / 1000, end: (item.end_time ?? 0) / 1000, text: String(item.text ?? "").trim() }))
    .filter(item => item.text);
  return { text: String(data?.result?.text ?? "").trim(), segments, durationSeconds: data?.audio_info?.duration != null ? data.audio_info.duration / 1000 : undefined };
}

async function transcribeStandard(input: TranscribeInput, resource: string): Promise<Transcript> {
  const { provider, decision } = await resolveProviderRequestContext(VOLC_ASR_PROVIDER_ID);
  const apiKey = resolvedProviderApiKey(provider);
  const base = provider.baseUrl.trim().replace(/\/+$/, "");
  const sensitive = providerErrorSensitiveValues(decision, apiKey, base, `${base}${STANDARD_PATH}/submit`);
  const signal = input.signal ?? AbortSignal.timeout(180_000);
  const headers = { "Content-Type": "application/json", "X-Api-Key": apiKey, "X-Api-Resource-Id": resource, "X-Api-Request-Id": input.requestId || randomUUID(), "X-Api-Sequence": "-1" };
  const fail = (response: Response, status: string) => {
    const raw = response.headers.get("X-Api-Message") || `语音识别请求失败（${status || response.status}）`;
    return new VolcAsrError(sanitizeProviderErrorText(raw, sensitive, "语音识别请求失败"), status || String(response.status));
  };
  const submit = await fetchWithProviderEgress(decision, `${base}${STANDARD_PATH}/submit`, {
    method: "POST", headers, signal,
    body: JSON.stringify({
      user: { uid: "inkvia-creative-agent" },
      audio: { data: input.data.toString("base64"), format: input.format },
      request: { model_name: "bigmodel", enable_itn: true, enable_punc: true, show_utterances: true },
    }),
  });
  const submitted = submit.headers.get("X-Api-Status-Code") || "";
  if (!submit.ok || submitted !== SUCCESS) throw fail(submit, submitted);
  for (let wait = 800; ; wait = Math.min(3000, wait * 1.5)) {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, wait);
      signal.addEventListener("abort", () => { clearTimeout(timer); reject(signal.reason ?? new Error("aborted")); }, { once: true });
    });
    const query = await fetchWithProviderEgress(decision, `${base}${STANDARD_PATH}/query`, { method: "POST", headers, body: "{}", signal });
    const status = query.headers.get("X-Api-Status-Code") || "";
    if (status === PROCESSING || status === QUEUED) continue;
    if (status === SILENT) return { text: "", segments: [] };
    if (!query.ok || status !== SUCCESS) throw fail(query, status);
    return toTranscript(await query.json().catch(() => null) as FlashResponse | null);
  }
}

async function transcribeFlash(input: TranscribeInput): Promise<Transcript> {
  const { provider, decision } = await resolveProviderRequestContext(VOLC_ASR_PROVIDER_ID);
  const apiKey = resolvedProviderApiKey(provider);
  const base = provider.baseUrl.trim().replace(/\/+$/, "");
  const url = `${base}${FLASH_PATH}`;
  const sensitive = providerErrorSensitiveValues(decision, apiKey, base, url);
  const response = await fetchWithProviderEgress(decision, url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Api-Key": apiKey,
      "X-Api-Resource-Id": FLASH_RESOURCE,
      "X-Api-Request-Id": input.requestId || randomUUID(),
      "X-Api-Sequence": "-1",
    },
    body: JSON.stringify({
      user: { uid: "inkvia-creative-agent" },
      audio: { data: input.data.toString("base64"), format: input.format },
      request: { model_name: "bigmodel", enable_itn: true, enable_punc: true, show_utterances: true },
    }),
    signal: input.signal ?? AbortSignal.timeout(120_000),
  });
  const status = response.headers.get("X-Api-Status-Code") || "";
  if (status === SILENT) return { text: "", segments: [] };
  const data = await response.json().catch(() => null) as FlashResponse | null;
  if (!response.ok || (status && status !== SUCCESS)) {
    const raw = response.headers.get("X-Api-Message") || `语音识别请求失败（${status || response.status}）`;
    // 4500003x 一般是账号没开通极速版资源
    const hint = /^4500003/.test(status) ? "，请在火山引擎豆包语音控制台开通「录音文件识别大模型-极速版」" : "";
    throw new VolcAsrError(`${sanitizeProviderErrorText(raw, sensitive, "语音识别请求失败")}${hint}`, status || String(response.status));
  }
  return toTranscript(data);
}
