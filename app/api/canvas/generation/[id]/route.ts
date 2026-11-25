import { apiErrorMessage, apiMessage } from "@/i18n/api-message";
// 画布出图/视频节点轮询自己生成结果的状态（按用户隔离）。
//   GET /api/canvas/generation/[id] → { status, url?, outputs, error? }
//
// 关键：异步生成（KIE/火山等）需要 finalizeGeneration(id)「查供应商→下载落库」才会完成。
// 原有 /api/history 轮询会兜底触发 finalize；本端点同样触发（finalize 自带 claim 锁，幂等安全），
// 否则任务会永远停在 running（前端表现为「一直生成中」）。

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getUserId } from "@/lib/server-auth";
import { normalizeMediaUrl } from "@/lib/media-url";
import { getCanvasGenerationOutputs } from "@/lib/canvas/generation-outputs";
import {
  FINALIZE_PROVIDERS,
  finalizeGeneration,
  isInProgressStatus,
  recoverStaleProcessingGeneration,
} from "@/lib/generation/finalize";
import { friendlyErrorPrimaryText } from "@/lib/error-friendly";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 同一记录触发节流，避免轮询风暴重复触发（finalize 自身有 claim，双保险）
const lastFinalizeAt = new Map<number, number>();
const FINALIZE_THROTTLE_MS = 3000;

async function maybeFinalize(gen: { id: number; status: string | null; localPath: string | null; externalProvider: string | null }) {
  if (gen.localPath) return;
  const status = String(gen.status || "").toLowerCase();
  if (!isInProgressStatus(status)) return;
  if (!FINALIZE_PROVIDERS.includes(String(gen.externalProvider || "").toLowerCase() as any)) return;
  const now = Date.now();
  if (now - (lastFinalizeAt.get(gen.id) || 0) < FINALIZE_THROTTLE_MS) return;
  lastFinalizeAt.set(gen.id, now);
  if (lastFinalizeAt.size > 500) {
    for (const [k, v] of lastFinalizeAt) if (now - v > FINALIZE_THROTTLE_MS * 8) lastFinalizeAt.delete(k);
  }
  if (status === "processing") {
    const recovered = await recoverStaleProcessingGeneration(gen.id);
    if (!recovered) return;
  }
  await finalizeGeneration(gen.id);
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {

  const authUserId = await getUserId(req);
  if (!authUserId) return NextResponse.json({ success: false, error: apiMessage("m48144f96c150") }, { status: 401 });
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ success: false, error: apiMessage("m39a179be21a4") }, { status: 400 });

  const gen = await prisma.generation.findFirst({
    where: { id, authUserId },
    select: { id: true, status: true, localPath: true, templateData: true, errorMsg: true, externalProvider: true },
  });
  if (!gen) return NextResponse.json({ success: false, error: apiMessage("me4ba03868d92") }, { status: 404 });

  // 未完成 → 触发收尾（fire-and-forget，下一次轮询即可拿到结果）
  void maybeFinalize(gen).catch(() => null);

  let notice: string | undefined;
  try { const metadata = JSON.parse(gen.templateData || "{}"); if (metadata.phase === "submission_unknown") notice = "提交状态待核实，请联系管理员核对原任务，勿重复生成"; else if (metadata.providerStatus === "unknown" && metadata.sunoRequest) notice = "上游暂未确认任务状态，继续查询原任务"; } catch {}
  return NextResponse.json({
    success: true,
    notice,
    status: gen.status,
    url: gen.localPath ? normalizeMediaUrl(gen.localPath) : null,
    outputs: gen.localPath ? getCanvasGenerationOutputs(gen) : [],
    error: apiErrorMessage(gen.errorMsg ? friendlyErrorPrimaryText(gen.errorMsg) : null),
  });
}
