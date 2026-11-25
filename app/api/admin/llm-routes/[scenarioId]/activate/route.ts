import { apiErrorMessage, apiMessage } from "@/i18n/api-message";
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { requireAdminRequest } from "@/lib/admin-auth";
import {
  LlmAdminRequestError,
  isAdminLlmScenarioId,
  resolveAdminLlmNetworkRevision,
  testAdminLlmRoute,
} from "@/lib/llm-routing/admin";
import { saveLlmRouteBinding } from "@/lib/llm-routing/bindings";
import { getPublicLlmError, LlmGatewayError } from "@/lib/llm-routing/gateway";
import { LLM_SCENARIOS } from "@/lib/llm-routing/scenarios";
import prisma from "@/lib/prisma";
import {
  readProviderAdminRevision,
  rotateProviderAdminRevision,
} from "@/lib/providers/admin-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest, context: { params: { scenarioId: string } }) {
  const auth = requireAdminRequest(req);
  if (!auth.ok) return json({ error: apiErrorMessage(auth.error) }, 401);
  const body = await req.json().catch(() => null);
  try {
    if (!isAdminLlmScenarioId(context.params.scenarioId)) {
      throw new LlmAdminRequestError("未知 LLM 场景");
    }
    const settingKey = LLM_SCENARIOS[context.params.scenarioId].settingKey;
    const bindingBeforeProbe = await prisma.appSetting.findUnique({
      where: { key: settingKey },
      select: { value: true },
    });
    const revisionBeforeProbe = await readProviderAdminRevision(prisma);
    const tested = await testAdminLlmRoute(context.params.scenarioId, body);
    await prisma.$transaction(async (client) => {
      const revisionAfterProbe = await readProviderAdminRevision(client);
      if (revisionAfterProbe !== revisionBeforeProbe) {
        throw new LlmAdminRequestError("平台或 LLM 路由配置已被修改，请重新测试", 409, "route-changed");
      }
      const bindingAfterProbe = await client.appSetting.findUnique({
        where: { key: settingKey },
        select: { value: true },
      });
      if ((bindingAfterProbe?.value ?? null) !== (bindingBeforeProbe?.value ?? null)) {
        throw new LlmAdminRequestError("LLM 路由已被其他管理员修改，请重新测试", 409, "route-changed");
      }
      let currentNetworkRevision: string;
      try {
        const current = await resolveAdminLlmNetworkRevision(tested.scenarioId, {
          providerId: tested.providerId,
          modelId: tested.modelId,
        }, client);
        currentNetworkRevision = current.networkRevision;
      } catch (error) {
        if (error instanceof LlmAdminRequestError) {
          throw new LlmAdminRequestError("LLM 路由配置已在探测后变化，请重试", 409, "route-changed");
        }
        throw error;
      }
      if (tested.networkRevision !== currentNetworkRevision) {
        throw new LlmAdminRequestError("LLM 路由配置已在探测后变化，请重试", 409, "route-changed");
      }
      await saveLlmRouteBinding(tested.scenarioId, {
        providerId: tested.providerId,
        modelId: tested.modelId,
        networkRevision: tested.networkRevision,
      }, client);
      await rotateProviderAdminRevision(client);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return json({
      success: true,
      result: tested.result,
      binding: { providerId: tested.providerId, modelId: tested.modelId },
    });
  } catch (error) {
    if ((error as { code?: string })?.code === "P2034") {
      return json(
        { success: false, error: apiMessage("m71f9b0309956"), status: "write-conflict" },
        409,
      );
    }
    if (error instanceof LlmAdminRequestError) {
      return json(
        { success: false, error: apiErrorMessage(error.message), status: error.code },
        error.status,
      );
    }
    if (error instanceof LlmGatewayError) {
      return json(
        { success: false, error: apiErrorMessage(getPublicLlmError(error)), status: error.kind },
        502,
      );
    }
    return json({ success: false, error: apiMessage("mf6273398c9e2") }, 502);
  }
}
