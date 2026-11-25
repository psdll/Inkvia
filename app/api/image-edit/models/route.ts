import { isSeedream55Model } from "@/lib/volcengine-seedream-55";
import { NextResponse } from "next/server";
import { APIMART_GPT_IMAGE_26_MODEL_ID } from "@/lib/apimart-image-models";
import { getVisibleImageEditModels } from "@/lib/image-edit-models";
import { isOpenRouterGpt26Model } from "@/lib/openrouter-image-params";
import { isProviderModelEnabled } from "@/lib/providers/model-availability";
import { getRegisteredProviders } from "@/lib/providers/registry";

export const dynamic = "force-dynamic";

export async function GET() {
  const [models, providers] = await Promise.all([
    getVisibleImageEditModels(),
    getRegisteredProviders(),
  ]);
  const providersById = new Map(providers.map((provider) => [provider.id, provider]));
  return NextResponse.json({
    success: true,
    models: models
      .filter((model) => (!isSeedream55Model(model.id) && model.id !== APIMART_GPT_IMAGE_26_MODEL_ID && !isOpenRouterGpt26Model(model.id)) || isProviderModelEnabled(providers, "image", model.id))
      .map((model) => {
        const provider = providersById.get(model.provider);
        return {
          ...model,
          providerName: provider?.name || model.provider,
          egressMode: provider?.egressMode || "direct",
        };
      }),
  });
}
