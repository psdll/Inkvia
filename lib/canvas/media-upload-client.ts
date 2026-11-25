"use client";

async function json(response: Response) {
  return response.json().catch(() => null) as Promise<any>;
}

export async function uploadCanvasMedia(file: File) {
  const form = new FormData();
  form.append("file", file);
  const response = await fetch("/api/canvas/upload", { method: "POST", body: form });
  const payload = await json(response);
  if (!response.ok || !payload?.success) throw new Error(payload?.error || "上传失败");
  if (payload.url) return payload;
  const mediaId = String(payload.mediaId || "");
  if (!mediaId) throw new Error("上传结果缺少媒体标识");
  const deadline = Date.now() + 10 * 60_000;
  while (Date.now() < deadline) {
    const statusResponse = await fetch(`/api/canvas/media/${mediaId}`, { cache: "no-store" });
    const status = await json(statusResponse);
    if (statusResponse.ok && status?.success) {
      if (status.status === "ready" && status.publicUrl) {
        return {
          success: true,
          mediaId: status.id,
          status: status.status,
          kind: status.kind,
          url: status.publicUrl,
          variants: status.variants,
        };
      }
      if (status.status === "failed" || status.status === "purged") {
        throw new Error(status.failureMessage || "媒体安全处理失败");
      }
    }
    await new Promise((resolve) => window.setTimeout(resolve, 500));
  }
  throw new Error("媒体处理超时，请稍后重试");
}
