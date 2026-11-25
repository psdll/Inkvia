import "server-only";

import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { buildSeedAudioRequest, SEED_AUDIO_PROVIDER_ID, SEED_AUDIO_REFERENCE_MAX_BYTES, SEED_AUDIO_TIMEOUT_MS, validateSeedAudioMedia, type SeedAudioReference, type SeedAudioSettings } from "@/lib/seed-audio-models";
import { probeLocalMedia, resolveLocalUploadPath } from "@/lib/tool-media/media-probe";
import { resolvedProviderApiKey } from "@/lib/providers/resolve";
import { fetchWithProviderEgress, resolveProviderRequestContext } from "@/lib/providers/transport";
import { providerErrorSensitiveValues, sanitizeProviderErrorText } from "@/lib/providers/error-safety";

export type SeedAudioResult = {
  audioUrl?: string;
  audioBuffer?: Buffer;
  durationSeconds: number;
  originalDurationSeconds: number;
  traceId?: string;
};

export async function prepareSeedAudioReferences(input: SeedAudioSettings): Promise<SeedAudioReference[]> {
  buildSeedAudioRequest(input);
  const references: SeedAudioReference[] = [];
  for (const reference of input.references || []) {
    // Canvas media stays local. Send documented Base64 data without a public relay or re-encoding.
    if (reference.url.startsWith("/uploads/")) {
      const localPath = resolveLocalUploadPath(reference.url);
      const stat = await fs.stat(localPath);
      if (stat.size > SEED_AUDIO_REFERENCE_MAX_BYTES) throw new Error("Seed Audio 单条参考素材不能超过 10 MB");
      const probe = await probeLocalMedia({ localPath, fileName: path.basename(localPath), kind: reference.kind, declaredMime: "" });
      validateSeedAudioMedia({ kind: reference.kind, byteSize: stat.size, mime: probe.detectedMime, durationSeconds: probe.durationSeconds, audioCodecs: probe.audioCodecs });
      const data = (await fs.readFile(localPath)).toString("base64");
      references.push(reference.kind === "image" ? { image_data: data } : { audio_data: data });
    } else {
      let url: URL;
      try { url = new URL(reference.url); } catch { throw new Error("Seed Audio 参考素材地址不合法"); }
      if (url.protocol !== "https:" || url.username || url.password) throw new Error("Seed Audio 远端参考素材须使用 HTTPS 地址");
      // Remote reference limits are also validated by the provider; do not fetch arbitrary URLs here.
      references.push(reference.kind === "image" ? { image_url: url.href } : { audio_url: url.href });
    }
  }
  return references;
}

export async function seedAudioGenerate(input: SeedAudioSettings, requestId: string = randomUUID(), preparedReferences?: SeedAudioReference[]): Promise<SeedAudioResult> {
  const request = buildSeedAudioRequest(input, preparedReferences ?? await prepareSeedAudioReferences(input));
  const { provider, decision } = await resolveProviderRequestContext(SEED_AUDIO_PROVIDER_ID);
  const apiKey = resolvedProviderApiKey(provider);
  const base = provider.baseUrl.trim().replace(/\/+$/, "");
  const url = `${base}${request.endpoint}`;
  const sensitive = providerErrorSensitiveValues(decision, apiKey, base, url);
  try {
    const response = await fetchWithProviderEgress(decision, url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Api-Key": apiKey, "X-Api-Request-Id": requestId },
      body: JSON.stringify(request.body),
      signal: AbortSignal.timeout(SEED_AUDIO_TIMEOUT_MS),
    });
    const data = await response.json().catch(() => null) as Record<string, unknown> | null;
    if (!response.ok || (data?.code != null && Number(data.code) !== 0)) {
      const error = new Error(sanitizeProviderErrorText(String(data?.message || `Seed Audio 请求失败 (${response.status})`), sensitive, "Seed Audio 请求失败")) as Error & { statusCode: number };
      error.statusCode = response.ok ? 502 : response.status;
      throw error;
    }
    const durationSeconds = Number(data?.duration);
    const originalDurationSeconds = Number(data?.original_duration);
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || !Number.isFinite(originalDurationSeconds) || originalDurationSeconds <= 0 || originalDurationSeconds > 120) throw new Error("Seed Audio 未返回有效音频时长");
    const audio = typeof data?.audio === "string" ? data.audio : "";
    let audioUrl: string | undefined;
    if (typeof data?.url === "string") {
      try { const parsed = new URL(data.url); if (parsed.protocol === "https:" && !parsed.username && !parsed.password) audioUrl = parsed.href; } catch { /* Base64 is also a documented result. */ }
    }
    let audioBuffer: Buffer | undefined;
    if (audio && /^[A-Za-z0-9+/]+={0,2}$/.test(audio) && audio.length % 4 === 0) audioBuffer = Buffer.from(audio, "base64");
    if (!audioBuffer?.length && !audioUrl) throw new Error("Seed Audio 未返回有效音频结果");
    return { audioBuffer, audioUrl, durationSeconds, originalDurationSeconds, traceId: response.headers.get("X-Tt-Logid") || undefined };
  } catch (error) {
    if (error instanceof Error) {
      error.message = sanitizeProviderErrorText(error.message, sensitive, "Seed Audio 请求失败");
      throw error;
    }
    throw new Error("Seed Audio 请求失败");
  }
}
