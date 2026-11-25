import "server-only";

import type { ResolvedGenerationInput } from "@/lib/tool-media/generation-inputs";
import { platformHandlesMedia, resolveMediaForPlatform, type MediaDeliveryTarget } from "./deliver";
import type { MediaKind } from "./catalog";

function isMediaKind(kind: string): kind is MediaKind {
  return kind === "image" || kind === "video" || kind === "audio";
}

/**
 * Applies the platform's own hosting (or Base64) to tool-media inputs the platform can take.
 * Legacy-path inputs were already prepared through the same resolver and are left as they are.
 */
export async function deliverToolMediaForPlatform<T extends ResolvedGenerationInput>(
  inputs: T[],
  folder: string,
  mediaDeliveryTarget?: MediaDeliveryTarget | null,
): Promise<T[]> {
  if (!mediaDeliveryTarget) return inputs;
  return Promise.all(inputs.map(async (media) => {
    if (media.source !== "tool_media" || media.preparedForPlatform || !isMediaKind(media.kind)) return media;
    if (!(await platformHandlesMedia(mediaDeliveryTarget, media.kind))) return media;
    const modelUrl = await resolveMediaForPlatform(media.localPath, folder, mediaDeliveryTarget, media.kind);
    return { ...media, modelUrl };
  }));
}
