import { normalizeMediaUrl } from "@/lib/media-url";
import { sunoTrackSchema, type SunoTrack } from "@/lib/suno-models";

export type CanvasGenerationOutput = { url: string; generationId?: number; mediaId?: string; suno?: SunoTrack };

/** Read every persisted provider output, preserving its own generation identity. */
export function getCanvasGenerationOutputs(record: {
  id: number;
  localPath: string | null;
  templateData?: string | null;
}): CanvasGenerationOutput[] {
  let saved: Array<{ outputIndex?: number; localPath?: string; generationId?: number; suno?: SunoTrack }> = [];
  try {
    const metadata = JSON.parse(record.templateData || "{}");
    if (Array.isArray(metadata?.savedOutputs)) saved = metadata.savedOutputs.filter((item: unknown) => item && typeof item === "object");
  } catch {}
  if (saved.some(item => item.suno)) return saved.slice().sort((a, b) => (a.outputIndex ?? 0) - (b.outputIndex ?? 0)).flatMap(item => {
    const track = sunoTrackSchema.safeParse(item.suno);
    const url = normalizeMediaUrl(item.localPath);
    return track.success && url ? [{ url, generationId: item.generationId || record.id, suno: { ...track.data, ...(track.data.coverUrl ? { coverUrl: normalizeMediaUrl(track.data.coverUrl) } : {}) } }] : [];
  });
  const firstUrl = normalizeMediaUrl(record.localPath);
  const outputs: CanvasGenerationOutput[] = firstUrl ? [{ url: firstUrl, generationId: record.id }] : [];
  for (const item of saved.sort((a, b) => (a.outputIndex ?? 0) - (b.outputIndex ?? 0))) {
    const url = typeof item.localPath === "string" ? normalizeMediaUrl(item.localPath) : "";
    if (!url || outputs.some((output) => output.url === url)) continue;
    outputs.push({ url, ...(item.generationId ? { generationId: item.generationId } : {}) });
  }
  return outputs;
}
