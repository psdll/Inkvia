import { apiErrorMessage } from "@/i18n/api-message";
import { NextRequest, NextResponse } from "next/server";
import { requireAdminRequest } from "@/lib/admin-auth";
import { enqueueUserExportJob } from "@/lib/admin/user-export-runner";
import { DEFAULT_EXPORT_OPTIONS, type UserExportOptions } from "@/lib/admin/user-export-builder";
import { getMaxExportBytes } from "@/lib/admin/user-transfer-limits";
import { validateMigrationPassphrase } from "@/lib/admin/user-migration-package";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function bad(msg: string, status = 400) {
  return NextResponse.json({ error: apiErrorMessage(msg) }, { status });
}

function safeUserId(v: string) {
  const s = (v || "").trim();
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(s)) return "";
  if (s === "_builtin") return "";
  return s;
}

function asBool(v: unknown, dflt: boolean): boolean {
  if (v === true || v === 1 || v === "1" || v === "true") return true;
  if (v === false || v === 0 || v === "0" || v === "false") return false;
  return dflt;
}

export async function GET(req: NextRequest) {
  const auth = requireAdminRequest(req);
  if (!auth.ok) return bad(auth.error, 401);
  return NextResponse.json({ maxExportBytes: getMaxExportBytes() });
}

// 前端勾选项（include*）映射到构建器选项
function parseOptions(body: Record<string, unknown>): UserExportOptions {
  const d = DEFAULT_EXPORT_OPTIONS;
  return {
    generations: asBool(body.includeGenerations, d.generations),
    inputFiles: asBool(body.includeInputFiles, d.inputFiles),
    presets: asBool(body.includePresets, d.presets),
    mediaLibrary: asBool(body.includeMediaLibrary, d.mediaLibrary),
    materialAssets: asBool(body.includeMaterialAssets, d.materialAssets),
    agentData: asBool(body.includeAgentData, d.agentData),
    workspaceData: asBool(body.includeWorkspaceData, d.workspaceData),
    memories: asBool(body.includeMemories, d.memories),
    billing: asBool(body.includeBilling, d.billing),
    feedback: asBool(body.includeFeedback, d.feedback),
    logs: asBool(body.includeLogs, d.logs),
  };
}

/**
 * 入队一个用户数据导出任务。立即返回 jobId；前端通过 status 路由轮询进度，
 * 完成后通过 download 路由凭一次性 token 流式下载。
 *
 * 旧的 GET 同步全量打包（readFile 全部进内存 + JSZip 整包 buffer）已移除，
 * 改为异步流式任务，彻底解决大数据量 OOM / 超时 / 浏览器标签页崩溃问题。
 */
export async function POST(req: NextRequest) {
  const auth = requireAdminRequest(req);
  if (!auth.ok) return bad(auth.error, 401);

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }

  const userId = safeUserId(String(body.userId ?? ""));
  if (!userId) return bad("userId 无效");

  const authUserIdRaw = Number(body.authUserId ?? "");
  const authUserId = Number.isSafeInteger(authUserIdRaw) && authUserIdRaw > 0 ? authUserIdRaw : null;
  const archiveMode = body.archiveMode ?? (authUserId === null ? "data" : "portable");
  if (body.archiveMode !== undefined && body.archiveMode !== "portable" && body.archiveMode !== "migration" && body.archiveMode !== "data" && body.archiveMode !== "legacy") return bad("归档模式无效");
  if ((archiveMode === "migration" || archiveMode === "portable") && authUserId === null) return bad("迁移导出需要已注册账号");
  let migrationPassphrase: string | undefined;
  if (archiveMode === "migration") {
    try { migrationPassphrase = validateMigrationPassphrase(body.migrationPassphrase); }
    catch (err) { return bad(err instanceof Error ? err.message : "迁移口令无效"); }
  }

  const options = parseOptions(body);

  try {
    const jobId = await enqueueUserExportJob({ userId, authUserId, options, migrationPassphrase, portable: archiveMode === "portable" });
    return NextResponse.json({ jobId });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return bad(`创建导出任务失败：${message}`, 500);
  }
}
