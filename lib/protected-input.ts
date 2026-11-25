// 判断一个输入素材路径是否"需要先复制到 imports/ 再使用"。
// 规则：凡是被拖进/选进输入框的本地 /uploads/... 素材，只要还没落在 imports/ 下，
// 一律复制一份到 imports/，与来源目录（产品库、素材库、结果图 image_results、灵感库等）彻底解耦。
// 已经在 imports/ 下的（刚上传的文件）跳过；外部 http(s)/data: 由各自上传流程处理，这里不拦。
export function needsImportToImports(url: string | null | undefined): boolean {
  const s = String(url || "").trim();
  if (!s) return false;
  const rel = s.startsWith("uploads/") ? `/${s}` : s;
  if (!rel.startsWith("/uploads/")) return false; // 非本地 uploads 素材，不处理
  if (rel.startsWith("/uploads/imports/")) return false; // 已经在 imports/ 下
  return true;
}

// 把一个 /uploads/... 素材导入到 imports/（服务端从磁盘复制 + 建立 import 占位记录），
// 返回 imports/ 下的新路径。失败时抛错由调用方处理。
type ImportInputToImportsOptions = {
  fetcher?: typeof fetch;
  timeoutMs?: number;
};

const DEFAULT_IMPORT_TIMEOUT_MS = 60_000;

export async function importInputToImports(
  sourceUrl: string,
  userId: string,
  options: ImportInputToImportsOptions = {},
): Promise<string> {
  const form = new FormData();
  form.set("sourceUrl", sourceUrl);
  form.set("userId", userId);
  const controller = new AbortController();
  const timeoutMs = Number.isFinite(options.timeoutMs)
    ? Math.max(1, Number(options.timeoutMs))
    : DEFAULT_IMPORT_TIMEOUT_MS;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await (options.fetcher || fetch)("/api/assets/import", {
      method: "POST",
      body: form,
      signal: controller.signal,
    });
    if (controller.signal.aborted) {
      throw new Error("素材处理超时，请重新添加或重试");
    }
    const json = await res.json().catch(() => null);
    if (!res.ok) throw new Error(json?.error || "素材导入失败");
    const path = String(json?.data?.localPath || "");
    if (!path) throw new Error("素材导入失败");
    return path;
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error("素材处理超时，请重新添加或重试");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function importInputToImportsTracked(input: {
  sourceUrl: string;
  userId: string;
  inFlight: Set<string>;
  importer?: (sourceUrl: string, userId: string) => Promise<string>;
}) {
  const sourceUrl = String(input.sourceUrl || "").trim();
  if (!sourceUrl || input.inFlight.has(sourceUrl)) return null;
  input.inFlight.add(sourceUrl);
  try {
    return await (input.importer || importInputToImports)(sourceUrl, input.userId);
  } finally {
    input.inFlight.delete(sourceUrl);
  }
}
