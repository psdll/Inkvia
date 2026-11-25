import { getGptImage25SelectionValue, type GptImage25VariantOptions } from "@/lib/gpt-image-25-models";
import "server-only";
import { getVisibleImageEditModels, getVisibleToolboxModels } from "@/lib/image-edit-models";
import { getImageModelParams, type ImageModelParams } from "@/lib/generation/image-model-params";
import { getVideoModelSpec, type Sora2ModelSpec } from "@/lib/sora2";
import { TOOLBOX_MODEL_DEFINITIONS } from "@/lib/toolbox-models";
import { getRegisteredProviders } from "@/lib/providers/registry";
import { isProviderModelEnabled } from "@/lib/providers/model-availability";
import { readProxySettingRaw, resolveProviderProxyFromRaw } from "@/lib/providers/proxy-config";
import { hashCanvasMutationPayload } from "@/lib/canvas/mutation-contract";

export type MediaQualification = {
  available: boolean;
  reasons: string[];
  entitlement: "unverified";
  providerId: string;
  adapterId: string;
  routeConfigFingerprint: string;
};
export type EffectiveMediaIdentity = { aliases: string[]; qualification: MediaQualification; variants?: { mode: "flare" | "sunburst"; label: string; selectionId: string }[] };
export type EffectiveImageModel = { id: string; label: string; params: ImageModelParams } & EffectiveMediaIdentity;
export type EffectiveVideoModel = Sora2ModelSpec & EffectiveMediaIdentity;
export type EffectiveMediaCatalog = {
  version: 1;
  fingerprint: string;
  image: EffectiveImageModel[];
  video: EffectiveVideoModel[];
  unavailable: { id: string; label: string; mediaType: "image" | "video"; reasons: string[] }[];
};

/** Server-owned adapter catalog. Configuration readiness is not a tested entitlement. */
export async function getEffectiveCreativeMediaCatalog(): Promise<EffectiveMediaCatalog> {
  const [providers, images, videos] = await Promise.all([
    getRegisteredProviders(), getVisibleImageEditModels(), getVisibleToolboxModels("video"),
  ]);
  const rawProxy = providers.some(provider => provider.egressMode === "proxy") ? await readProxySettingRaw() : null;
  const image: EffectiveImageModel[] = [], video: EffectiveVideoModel[] = [];
  const unavailable: EffectiveMediaCatalog["unavailable"] = [];
  for (const definition of TOOLBOX_MODEL_DEFINITIONS) {
    if (definition.category !== "image" && definition.category !== "video") continue;
    const mediaType = definition.category;
    const effective = (mediaType === "image" ? images : videos).find(model => model.id === definition.id);
    const provider = providers.find(provider => provider.id === definition.provider);
    const proxy = provider?.egressMode === "proxy" ? resolveProviderProxyFromRaw(provider.id, rawProxy) : undefined;
    const reasons = [
      ...(!effective ? ["ADMIN_HIDDEN"] : []),
      ...(!isProviderModelEnabled(providers, mediaType, definition.id) ? ["PROVIDER_MODEL_DISABLED"] : []),
      ...(!provider?.apiKey?.trim() ? ["PROVIDER_KEY_MISSING"] : []),
      ...(provider?.configurationError === "invalid-egress" ? ["PROVIDER_EGRESS_INVALID"] : []),
      ...(proxy && proxy.status !== "ready" ? ["PROVIDER_PROXY_UNAVAILABLE"] : []),
      ...(mediaType === "video" && getVideoModelSpec(definition.id).id !== definition.id ? ["ADAPTER_UNSUPPORTED"] : []),
    ];
    const identity: EffectiveMediaIdentity = {
      aliases: [...new Set([definition.id, definition.label, effective?.label].filter((value): value is string => Boolean(value)))],
      qualification: {
        available: reasons.length === 0, reasons, entitlement: "unverified", providerId: definition.provider, adapterId: definition.id,
        // Secrets are hashed only on the server; no readable provider configuration leaves here.
        routeConfigFingerprint: hashCanvasMutationPayload({ provider, proxyFingerprint: proxy?.fingerprint }),
      },
    };
    if (reasons.length) unavailable.push({ id: definition.id, label: effective?.label ?? definition.label, mediaType, reasons });
    if (!effective) continue;
    if (mediaType === "image") {
      const variants = (effective as typeof effective & GptImage25VariantOptions).gptImage25Variants?.map(variant => ({ ...variant, selectionId: getGptImage25SelectionValue(definition.id, variant.mode) }));
      image.push({ id: definition.id, label: effective.label, params: getImageModelParams(definition.id), ...identity, ...(variants ? { variants } : {}) });
    }
    else video.push({ ...getVideoModelSpec(definition.id), ...effective, ...identity } as EffectiveVideoModel);
  }
  return { version: 1, fingerprint: hashCanvasMutationPayload({ image, video, unavailable }), image, video, unavailable };
}

/** Literal option evidence from the same effective page surface, without inferred synonyms. */
export function creativeRequirementOptionEvidence(catalog: EffectiveMediaCatalog) {
  return Object.fromEntries(([['aspectRatio', 'aspectRatios'], ['resolution', 'resolutions'], ['quality', 'qualities'], ['background', 'backgrounds']] as const).map(([field, key]) => [
    `image.params.${field}`, catalog.image.flatMap(model => model.qualification.available ? (model.params[key] ?? []).filter(option => !option.disabled).map(({ value, label }) => ({ value, label })) : []),
  ]));
}
