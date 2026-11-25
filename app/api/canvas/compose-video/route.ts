import { apiErrorMessage, apiMessage } from "@/i18n/api-message";
// 画布多选视频「合成」：按顺序把多段视频拼成一段（如两段 15 秒合成 30 秒），返回 MP4，
// 由前端走正常的画布上传流程落库并放到画布上。
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getUserId } from "@/lib/server-auth";
import { readCreativeAgentCanvas } from "@/lib/creative-agent/canvas-tools";
import { composeVideoClips, probeRuntimeMedia, type ComposeClip } from "@/lib/creative-agent/media-files";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;

const bodySchema = z.object({ canvasId: z.number().int().positive(), nodeIds: z.array(z.string().min(1).max(256)).min(2).max(20) }).strict();

export async function POST(req: NextRequest) {
  const authUserId = await getUserId(req);
  if (!authUserId) return NextResponse.json({ success: false, error: apiMessage("m48144f96c150") }, { status: 401 });
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ success: false, error: apiMessage("mc6bc381a01a0") }, { status: 400 });
  const { canvasId, nodeIds } = parsed.data;
  try {
    // 只合成当前用户能读取的这张画布上的视频，地址取自服务端画布数据，不信任前端传的地址
    const snapshot = await readCreativeAgentCanvas(authUserId, canvasId, nodeIds);
    const clips: ComposeClip[] = [];
    let width = 0, height = 0;
    for (const [index, nodeId] of nodeIds.entries()) {
      const data = snapshot.nodes.find(node => node.id === nodeId)?.data;
      const url = data?.kind === "video" ? data.url : data?.kind === "videoTask" && data.status === "success" ? data.outputUrl : undefined;
      if (!url?.startsWith("/uploads/")) return NextResponse.json({ success: false, error: apiErrorMessage(`第 ${index + 1} 段不是已完成的本地视频`) }, { status: 400 });
      const facts = await probeRuntimeMedia(url, "video");
      if (facts.state !== "verified" || !facts.durationSeconds) return NextResponse.json({ success: false, error: apiErrorMessage(`第 ${index + 1} 段视频无法解码`) }, { status: 400 });
      if (!width) { width = facts.width || 1080; height = facts.height || 1920; }
      clips.push({ storageRef: url, durationSeconds: facts.durationSeconds, hasAudio: Boolean(facts.audioCodecs?.length) });
    }
    // 成片尺寸跟第一段一致，长边不超过 1920
    const scale = Math.min(1, 1920 / Math.max(width, height));
    const size = { width: Math.round(width * scale / 2) * 2, height: Math.round(height * scale / 2) * 2 };
    const bytes = await composeVideoClips(clips, { ...size, keepOriginalAudio: true });
    return new NextResponse(new Uint8Array(bytes), { headers: { "Content-Type": "video/mp4", "Cache-Control": "no-store", "X-Composed-Duration": clips.reduce((sum, clip) => sum + clip.durationSeconds, 0).toFixed(2), "X-Composed-Width": String(size.width), "X-Composed-Height": String(size.height) } });
  } catch (error) {
    const message = String((error as { stderr?: string })?.stderr || (error as Error)?.message || "").trim();
    return NextResponse.json({ success: false, error: apiErrorMessage(`合成失败：${message.slice(-160) || "请稍后重试"}`) }, { status: 500 });
  }
}
