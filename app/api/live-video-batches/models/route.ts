import { NextResponse } from "next/server";
import {
  filterLiveVideoBatchModelSpecs,
  getLiveVideoBatchInputModes,
  getLiveVideoDurationOptions,
} from "@/lib/live-video-batch/video-models";
import { getVisibleToolboxModels } from "@/lib/image-edit-models";
import { getRegisteredProviders } from "@/lib/providers/registry";

export const dynamic = "force-dynamic";

export async function GET() {
  const [providers, visibleModels] = await Promise.all([
    getRegisteredProviders(),
    getVisibleToolboxModels("video"),
  ]);
  const visibleById = new Map(visibleModels.map((model) => [model.id, model]));
  const providersById = new Map(providers.map((provider) => [provider.id, provider]));
  return NextResponse.json({
    success: true,
    models: filterLiveVideoBatchModelSpecs(visibleModels.map((model) => model.id))
      .filter((model) => visibleById.has(model.id))
      .map((model) => {
        const visibleModel = visibleById.get(model.id)!;
        return {
          id: model.id,
          label: visibleModel.label,
          provider: model.provider,
          providerName: providersById.get(model.provider)?.name || model.provider,
          supportedResolutions: visibleModel.supportedResolutions || [],
          supportedRatios: model.supportedRatios || ["adaptive"],
          supportedInputModes: getLiveVideoBatchInputModes(model),
          supportsGenerateAudio: model.supportsGenerateAudio,
          durationOptions: getLiveVideoDurationOptions({ ...model, maxDurationSeconds: visibleModel.maxDurationSeconds ?? model.maxDurationSeconds }),
        };
      }),
  });
}
