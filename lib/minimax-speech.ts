import "server-only";

import { createHash } from "node:crypto";
import { File as UndiciFile, FormData as UndiciFormData } from "undici";

import {
  inferCanvasVoiceMetadata,
  type CanvasMiniMaxVoice,
  type CanvasVoiceAge,
  type CanvasVoiceGender,
} from "@/lib/canvas/minimax-voice-library";
import {
  buildMiniMaxVoiceCloneRequest,
  buildMiniMaxSpeechRequest,
  type MiniMaxSpeechSettings,
  type MiniMaxVoiceCloneSettings,
} from "@/lib/minimax-speech-models";
import {
  providerErrorSensitiveValues,
  sanitizeProviderErrorFields,
  sanitizeProviderErrorText,
} from "@/lib/providers/error-safety";
import { resolvedProviderApiKey } from "@/lib/providers/resolve";
import {
  fetchWithProviderEgress,
  resolveProviderRequestContext,
} from "@/lib/providers/transport";

const MINIMAX_PROVIDER_ID = "minimax";

export type MiniMaxVoice = CanvasMiniMaxVoice;

export type MiniMaxSpeechResult = {
  audioUrl: string;
  traceId?: string;
  audioLengthMs?: number;
  usageCharacters?: number;
  audioSize?: number;
};

export type MiniMaxVoiceCloneResult = {
  voiceId: string;
  demoAudioUrl?: string;
};

function clean(value: unknown) {
  return String(value ?? "").trim();
}

async function resolveMiniMaxEndpoint() {
  const context = await resolveProviderRequestContext(MINIMAX_PROVIDER_ID);
  return {
    base: clean(context.provider.baseUrl).replace(/\/+$/, ""),
    apiKey: resolvedProviderApiKey(context.provider),
    decision: context.decision,
  };
}

type MiniMaxEndpoint = Awaited<ReturnType<typeof resolveMiniMaxEndpoint>>;

export type MiniMaxVoiceCatalogSource = {
  scopeKey: string;
  load: () => Promise<MiniMaxVoice[]>;
  deleteClonedVoice: (voiceId: string) => Promise<void>;
};

async function providerError(
  response: Response,
  sensitive: string[],
  fallback: string,
) {
  const text = await response.text();
  let parsed: any = null;
  try {
    parsed = sanitizeProviderErrorFields(JSON.parse(text), sensitive);
  } catch {
    parsed = null;
  }
  const raw = clean(
    parsed?.base_resp?.status_msg ||
      parsed?.error?.message ||
      parsed?.message ||
      text ||
      fallback,
  );
  const detail = sanitizeProviderErrorText(raw, sensitive, fallback);
  const error = new Error(
    detail === fallback ? fallback : `${fallback}: ${detail}`,
  ) as Error & { statusCode: number };
  error.statusCode = response.status || 502;
  return error;
}

export async function miniMaxGenerateSpeech(
  input: MiniMaxSpeechSettings,
): Promise<MiniMaxSpeechResult> {
  const request = buildMiniMaxSpeechRequest(input);
  const { base, apiKey, decision } = await resolveMiniMaxEndpoint();
  const url = `${base}${request.endpoint}`;
  const sensitive = providerErrorSensitiveValues(decision, apiKey, base, url);

  try {
    const response = await fetchWithProviderEgress(decision, url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request.body),
      signal: AbortSignal.timeout(120_000),
    });
    if (!response.ok)
      throw await providerError(
        response,
        sensitive,
        `MiniMax 语音请求失败 (${response.status})`,
      );

    const data = (await response.json()) as any;
    const statusCode = Number(data?.base_resp?.status_code ?? 0);
    if (statusCode !== 0) {
      const message = sanitizeProviderErrorText(
        clean(
          data?.base_resp?.status_msg || `MiniMax 语音请求失败 (${statusCode})`,
        ),
        sensitive,
        "MiniMax 语音请求失败",
      );
      throw new Error(message);
    }
    const audioUrl = clean(data?.data?.audio);
    try {
      if (new URL(audioUrl).protocol !== "https:") throw new Error();
    } catch {
      throw new Error("MiniMax 未返回有效音频地址");
    }

    const extra = data?.extra_info || {};
    return {
      audioUrl,
      traceId: clean(data?.trace_id) || undefined,
      audioLengthMs: Number.isFinite(Number(extra.audio_length))
        ? Number(extra.audio_length)
        : undefined,
      usageCharacters: Number.isFinite(Number(extra.usage_characters))
        ? Number(extra.usage_characters)
        : undefined,
      audioSize: Number.isFinite(Number(extra.audio_size))
        ? Number(extra.audio_size)
        : undefined,
    };
  } catch (error) {
    if (error instanceof Error) {
      error.message = sanitizeProviderErrorText(
        error.message,
        sensitive,
        "MiniMax 语音请求失败",
      );
      throw error;
    }
    throw new Error("MiniMax 语音请求失败");
  }
}

export async function miniMaxCloneVoice(
  file: File,
  settings: Omit<MiniMaxVoiceCloneSettings, "fileId">,
): Promise<MiniMaxVoiceCloneResult> {
  buildMiniMaxVoiceCloneRequest({ ...settings, fileId: 1 });
  const { base, apiKey, decision } = await resolveMiniMaxEndpoint();
  const uploadUrl = `${base}/v1/files/upload`;
  const cloneUrl = `${base}/v1/voice_clone`;
  const sensitive = providerErrorSensitiveValues(
    decision,
    apiKey,
    base,
    uploadUrl,
    cloneUrl,
  );

  try {
    const form = new UndiciFormData();
    form.append("purpose", "voice_clone");
    form.append(
      "file",
      new UndiciFile([new Uint8Array(await file.arrayBuffer())], file.name, {
        type: file.type,
      }),
      file.name,
    );
    const uploadResponse = await fetchWithProviderEgress(decision, uploadUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: AbortSignal.timeout(120_000),
    });
    if (!uploadResponse.ok)
      throw await providerError(
        uploadResponse,
        sensitive,
        `MiniMax 音色文件上传失败 (${uploadResponse.status})`,
      );
    const uploadData = (await uploadResponse.json()) as any;
    const uploadStatus = Number(uploadData?.base_resp?.status_code ?? 0);
    if (uploadStatus !== 0) {
      throw new Error(
        clean(uploadData?.base_resp?.status_msg) ||
          `MiniMax 音色文件上传失败 (${uploadStatus})`,
      );
    }
    const fileId = Number(uploadData?.file?.file_id);
    const request = buildMiniMaxVoiceCloneRequest({ ...settings, fileId });
    const cloneResponse = await fetchWithProviderEgress(decision, cloneUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request.body),
      signal: AbortSignal.timeout(120_000),
    });
    if (!cloneResponse.ok)
      throw await providerError(
        cloneResponse,
        sensitive,
        `MiniMax 音色复刻失败 (${cloneResponse.status})`,
      );
    const cloneData = (await cloneResponse.json()) as any;
    const cloneStatus = Number(cloneData?.base_resp?.status_code ?? 0);
    if (cloneStatus !== 0) {
      throw new Error(
        clean(cloneData?.base_resp?.status_msg) ||
          `MiniMax 音色复刻失败 (${cloneStatus})`,
      );
    }
    const demoAudioUrl = clean(cloneData?.demo_audio);
    return {
      voiceId: request.body.voice_id,
      demoAudioUrl: demoAudioUrl || undefined,
    };
  } catch (error) {
    if (error instanceof Error) {
      error.message = sanitizeProviderErrorText(
        error.message,
        sensitive,
        "MiniMax 音色复刻失败",
      );
      throw error;
    }
    throw new Error("MiniMax 音色复刻失败");
  }
}

function normalizeVoice(
  raw: any,
  source: MiniMaxVoice["source"],
): MiniMaxVoice | null {
  const id = clean(raw?.voice_id);
  if (!id) return null;
  const description = Array.isArray(raw?.description)
    ? raw.description.map(clean).filter(Boolean).join("；")
    : clean(raw?.description);
  const rawGender = clean(raw?.gender).toLowerCase();
  const gender: CanvasVoiceGender = [
    "male",
    "female",
    "character",
    "unknown",
  ].includes(rawGender)
    ? (rawGender as CanvasVoiceGender)
    : "unknown";
  const rawAge = clean(raw?.age).toLowerCase();
  const age: CanvasVoiceAge = [
    "youth",
    "adult",
    "child",
    "senior",
    "unknown",
  ].includes(rawAge)
    ? (rawAge as CanvasVoiceAge)
    : "unknown";
  return inferCanvasVoiceMetadata({
    id,
    name: clean(raw?.voice_name) || id,
    description,
    source,
    language: clean(raw?.language || raw?.language_code) || undefined,
    accent: clean(raw?.accent) || undefined,
    gender,
    age,
  });
}

async function fetchMiniMaxVoices({
  base,
  apiKey,
  decision,
}: MiniMaxEndpoint): Promise<MiniMaxVoice[]> {
  const url = `${base}/v1/get_voice`;
  const sensitive = providerErrorSensitiveValues(decision, apiKey, base, url);
  const response = await fetchWithProviderEgress(decision, url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ voice_type: "all" }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok)
    throw await providerError(
      response,
      sensitive,
      `MiniMax 音色查询失败 (${response.status})`,
    );
  const data = (await response.json()) as any;
  const statusCode = Number(data?.base_resp?.status_code ?? 0);
  if (statusCode !== 0) {
    throw new Error(
      sanitizeProviderErrorText(
        clean(data?.base_resp?.status_msg),
        sensitive,
        "MiniMax 音色查询失败",
      ),
    );
  }
  return [
    ...(Array.isArray(data?.system_voice) ? data.system_voice : []).map(
      (voice: any) => normalizeVoice(voice, "system"),
    ),
    ...(Array.isArray(data?.voice_cloning) ? data.voice_cloning : []).map(
      (voice: any) => normalizeVoice(voice, "cloned"),
    ),
    ...(Array.isArray(data?.voice_generation) ? data.voice_generation : []).map(
      (voice: any) => normalizeVoice(voice, "generated"),
    ),
  ].filter((voice): voice is MiniMaxVoice => Boolean(voice));
}

async function deleteMiniMaxClonedVoice({ base, apiKey, decision }: MiniMaxEndpoint, voiceId: string) {
  const url = `${base}/v1/delete_voice`;
  const sensitive = providerErrorSensitiveValues(decision, apiKey, base, url);
  const response = await fetchWithProviderEgress(decision, url, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ voice_type: "voice_cloning", voice_id: voiceId }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw await providerError(response, sensitive, "MiniMax 音色删除失败");
  const data = await response.json();
  if (data?.base_resp?.status_code !== 0) {
    throw new Error(sanitizeProviderErrorText(clean(data?.base_resp?.status_msg), sensitive, "MiniMax 未确认音色删除成功"));
  }
}

export async function resolveMiniMaxVoiceCatalogSource(): Promise<MiniMaxVoiceCatalogSource> {
  const endpoint = await resolveMiniMaxEndpoint();
  const scopeKey = createHash("sha256")
    .update(
      [
        MINIMAX_PROVIDER_ID,
        endpoint.base,
        endpoint.decision.cacheKey,
        endpoint.apiKey,
      ].join("\u0000"),
    )
    .digest("hex")
    .slice(0, 32);
  return {
    scopeKey,
    load: () => fetchMiniMaxVoices(endpoint),
    deleteClonedVoice: (voiceId) => deleteMiniMaxClonedVoice(endpoint, voiceId),
  };
}

export async function miniMaxListVoices(): Promise<MiniMaxVoice[]> {
  const source = await resolveMiniMaxVoiceCatalogSource();
  return source.load();
}
