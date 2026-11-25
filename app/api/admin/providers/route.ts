import { apiErrorMessage, apiMessage } from "@/i18n/api-message";
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { requireAdminRequest } from "@/lib/admin-auth";
import { getLlmRouteBinding } from "@/lib/llm-routing/bindings";
import { resolveLlmRouteFromProviders } from "@/lib/llm-routing/resolver";
import { LLM_SCENARIOS } from "@/lib/llm-routing/scenarios";
import type { LlmRouteStatus, LlmScenarioId } from "@/lib/llm-routing/types";
import prisma from "@/lib/prisma";
import { isDesktopMode } from "@/lib/desktop-mode";
import {
  ProviderAdminValidationError,
  readProviderAdminRevision,
  rotateProviderAdminRevision,
  sanitizeProviderAdminInput,
  sanitizeSingleProviderAdminInput,
} from "@/lib/providers/admin-config";
import {
  applyProxyOverrideAction,
  buildProxySafeView,
  buildProxyOverrideCandidate,
  readProxySettingRaw,
  resolveProviderProxyFromRaw,
  type ProxyOverrideAction,
} from "@/lib/providers/proxy-config";
import {
  getProvidersOverview,
  getSavedProviders,
  mergeProviderSecretsForSave,
  mergeSingleProviderForSave,
  mergeSavedProvidersWithBuiltins,
  saveProviders,
} from "@/lib/providers/registry";
import type { ProviderConfig } from "@/lib/providers/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" } as const;

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE_HEADERS });
}

function parseProxyAction(value: unknown): ProxyOverrideAction {
  if (!value || typeof value !== "object") {
    throw new ProviderAdminValidationError("proxyAction 必须明确指定 keep、set、disable 或 inherit");
  }
  const action = String((value as { action?: unknown }).action ?? "");
  if (action === "keep" || action === "disable" || action === "inherit") return { action };
  if (action === "system" && isDesktopMode()) return { action };
  if (action === "set" && typeof (value as { url?: unknown }).url === "string") {
    return { action, url: (value as { url: string }).url };
  }
  throw new ProviderAdminValidationError("proxyAction 无效");
}

function proxyStatuses(providers: ProviderConfig[], rawProxy: string | null) {
  return Object.fromEntries(providers
    .map((provider) => [provider.id, resolveProviderProxyFromRaw(provider.id, rawProxy).status]));
}

async function findBindingConflict(
  providers: ProviderConfig[],
  rawProxy: string | null,
  clearedProviderIds: Set<string>,
  client: Prisma.TransactionClient,
  affectedProviderIds?: ReadonlySet<string>,
): Promise<{ scenarioId: LlmScenarioId; status: LlmRouteStatus } | null> {
  const proxyStatusByProviderId = proxyStatuses(providers, rawProxy);
  for (const scenarioId of Object.keys(LLM_SCENARIOS) as LlmScenarioId[]) {
    const binding = await getLlmRouteBinding(scenarioId, client);
    if (!binding) continue;
    if (affectedProviderIds && !affectedProviderIds.has(binding.providerId)) continue;
    if (clearedProviderIds.has(binding.providerId)) return { scenarioId, status: "missing-key" };
    const result = resolveLlmRouteFromProviders({
      scenarioId,
      binding,
      providers,
      proxyStatusByProviderId,
    });
    if (result.status !== "ready") return { scenarioId, status: result.status };
  }
  return null;
}

async function buildSnapshot(client: Prisma.TransactionClient) {
  const overview = await getProvidersOverview(client);
  const rawProxy = await readProxySettingRaw(client);
  const proxy = buildProxySafeView(rawProxy);
  const proxyStatusByProviderId = proxyStatuses(overview.providers, rawProxy);
  const revision = await readProviderAdminRevision(client);
  return { ...overview, proxy, proxyStatusByProviderId, revision };
}

export async function GET(req: NextRequest) {
  const auth = requireAdminRequest(req);
  if (!auth.ok) return json({ error: apiErrorMessage(auth.error) }, 401);

  try {
    if (isDesktopMode() && req.nextUrl.searchParams.get("proxyStatus") === "1") {
      return json({ success: true, proxy: buildProxySafeView(await readProxySettingRaw()) });
    }
    const snapshot = await prisma.$transaction(
      async (client) => buildSnapshot(client),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    return json({ success: true, ...snapshot });
  } catch {
    return json({ error: apiMessage("mcc6304f0ce6a") }, 500);
  }
}

export async function POST(req: NextRequest) {
  const auth = requireAdminRequest(req);
  if (!auth.ok) return json({ error: apiErrorMessage(auth.error) }, 401);

  const body = await req.json().catch(() => null) as {
    expectedRevision?: unknown;
    provider?: unknown;
    providers?: unknown;
    proxyAction?: unknown;
  } | null;
  const expectedRevision = typeof body?.expectedRevision === "string"
    ? body.expectedRevision.trim()
    : "";
  if (!expectedRevision) {
    return json({
      error: apiMessage("m2f4ebad4246b"),
      status: "stale-revision",
    }, 409);
  }
  const hasSingleProviderPayload = body?.provider !== undefined;
  const hasProviderListPayload = Array.isArray(body?.providers);
  if (body?.providers !== undefined && !hasProviderListPayload) {
    return json({ error: apiMessage("m333ce42a20b9") }, 400);
  }
  if (hasSingleProviderPayload && hasProviderListPayload) {
    return json({ error: apiMessage("m6bb1edf00196") }, 400);
  }
  const hasProviderPayload = hasSingleProviderPayload || hasProviderListPayload;

  let proxyAction: ProxyOverrideAction;
  try {
    proxyAction = parseProxyAction(body?.proxyAction);
  } catch (error) {
    return json({ error: apiErrorMessage(error instanceof Error ? error.message : apiMessage("mff105faceb1f")) }, 400);
  }
  if (!hasProviderPayload && proxyAction.action === "keep") {
    return json({ error: apiMessage("m53144a52ac03") }, 400);
  }

  try {
    const result = await prisma.$transaction(async (client) => {
      const currentRevision = await readProviderAdminRevision(client);
      if (currentRevision !== expectedRevision) return { kind: "stale" as const };

      const existing = await getSavedProviders(client);
      const cleaned = hasSingleProviderPayload
        ? [sanitizeSingleProviderAdminInput(body!.provider, existing)]
        : hasProviderListPayload
          ? sanitizeProviderAdminInput(body!.providers as unknown[], existing)
          : existing;
      const merged = hasSingleProviderPayload
        ? mergeSingleProviderForSave(cleaned[0], existing)
        : hasProviderListPayload
          ? mergeProviderSecretsForSave(cleaned, existing)
          : existing;
      const registered = mergeSavedProvidersWithBuiltins(merged);
      const currentProxyRaw = await readProxySettingRaw(client);
      const candidateProxyRaw = buildProxyOverrideCandidate(currentProxyRaw, proxyAction);
      const clearedProviderIds = new Set(
        cleaned.filter((provider) => provider.clearApiKey).map((provider) => provider.id),
      );
      const conflict = await findBindingConflict(
        registered,
        candidateProxyRaw,
        clearedProviderIds,
        client,
        hasSingleProviderPayload ? new Set([cleaned[0].id]) : undefined,
      );
      if (conflict) return { kind: "binding-conflict" as const, conflict };

      if (hasProviderPayload) await saveProviders(merged, client);
      await applyProxyOverrideAction(client, proxyAction);
      await rotateProviderAdminRevision(client);
      return { kind: "ok" as const, snapshot: await buildSnapshot(client) };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    if (result.kind === "stale") {
      return json({
        error: apiMessage("mca745d415ca4"),
        status: "stale-revision",
      }, 409);
    }
    if (result.kind === "binding-conflict") {
      return json({
        error: apiErrorMessage(`场景 ${result.conflict.scenarioId} 的当前 LLM 路由会失效（${result.conflict.status}），请先切换路由`),
        status: result.conflict.status,
      }, 409);
    }
    return json({ success: true, ...result.snapshot });
  } catch (error) {
    if (error instanceof ProviderAdminValidationError) {
      return json({ error: apiErrorMessage(error.message), status: "invalid-config" }, 400);
    }
    const code = (error as { code?: string })?.code;
    if (code === "P2034" || code === "P2002") {
      return json({
        error: apiMessage("m7d5378843fe3"),
        status: "write-conflict",
      }, 409);
    }
    if (error instanceof Error && /代理/.test(error.message)) {
      return json({ error: apiErrorMessage(error.message), status: "invalid-proxy" }, 400);
    }
    return json({ error: apiMessage("m30f48ece7dcb") }, 500);
  }
}
