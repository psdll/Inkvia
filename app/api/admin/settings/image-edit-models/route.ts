import { apiErrorMessage, apiMessage } from "@/i18n/api-message";
import { NextRequest, NextResponse } from "next/server";
import { requireAdminRequest } from "@/lib/admin-auth";
import { getRegisteredProviders } from "@/lib/providers/registry";
import { getReadOnlyProviderModels } from "@/lib/admin/model-display-catalog";
import { getLlmModelsOverview, saveLlmModelVisibility, saveLlmModelDisplayNames } from "@/lib/llm-routing/visibility";
import {
  getToolboxModelsOverview,
  saveSeedanceResolutionVisibility,
  saveVideoDurationVisibility,
  saveToolboxModelDisplayNames,
  saveToolboxModelVisibility,
} from "@/lib/image-edit-models";

export const dynamic = "force-dynamic";

async function getOverview() {
  const [media, llm, providers] = await Promise.all([getToolboxModelsOverview(), getLlmModelsOverview(), getRegisteredProviders()]);
  const models = [...media.models, ...llm.models];
  return { ...media, providers: providers.map(({ id, name, enabled }) => ({ id, name, enabled: enabled !== false })), models: [...models, ...getReadOnlyProviderModels(providers, models)], visibility: { ...media.visibility, ...llm.visibility }, displayNames: { ...media.displayNames, ...llm.displayNames } };
}

export async function GET(req: NextRequest) {
  const auth = requireAdminRequest(req);
  if (!auth.ok) return NextResponse.json({ success: false, error: apiErrorMessage(auth.error) }, { status: 401 });

  const overview = await getOverview();
  return NextResponse.json({ success: true, ...overview });
}

export async function POST(req: NextRequest) {
  const auth = requireAdminRequest(req);
  if (!auth.ok) return NextResponse.json({ success: false, error: apiErrorMessage(auth.error) }, { status: 401 });

  const body = (await req.json().catch(() => null)) as {
    visibility?: unknown;
    resolutionVisibility?: unknown;
    durationVisibility?: unknown;
    displayNames?: unknown;
  } | null;
  if (!body || !body.visibility || typeof body.visibility !== "object" || Array.isArray(body.visibility)) {
    return NextResponse.json({ success: false, error: apiMessage("m597ee499a12a") }, { status: 400 });
  }
  if (
    body.resolutionVisibility === undefined
    || !body.resolutionVisibility
    || typeof body.resolutionVisibility !== "object"
    || Array.isArray(body.resolutionVisibility)
  ) {
    return NextResponse.json({ success: false, error: apiMessage("m446b9083ec6c") }, { status: 400 });
  }
  if (
    body.displayNames !== undefined
    && (!body.displayNames || typeof body.displayNames !== "object" || Array.isArray(body.displayNames))
  ) {
    return NextResponse.json({ success: false, error: apiMessage("m38aa621a435b") }, { status: 400 });
  }

  if (body.durationVisibility !== undefined
    && (!body.durationVisibility || typeof body.durationVisibility !== "object" || Array.isArray(body.durationVisibility))) {
    return NextResponse.json({ success: false, error: apiMessage("mf9f4f1785963") }, { status: 400 });
  }
  const writes: Promise<unknown>[] = [
    saveLlmModelVisibility(body.visibility as Record<string, boolean>),
    saveToolboxModelVisibility(body.visibility as Record<string, boolean>),
    saveSeedanceResolutionVisibility(body.resolutionVisibility as Record<string, Record<string, boolean>>),
  ];
  if (body.durationVisibility !== undefined) {
    writes.push(saveVideoDurationVisibility(body.durationVisibility as Record<string, boolean>));
  }
  if (body.displayNames !== undefined) {
    writes.push(saveToolboxModelDisplayNames(body.displayNames as Record<string, string>));
    writes.push(saveLlmModelDisplayNames(body.displayNames as Record<string, string>));
  }
  await Promise.all(writes);
  const overview = await getOverview();
  return NextResponse.json({ success: true, ...overview });
}
