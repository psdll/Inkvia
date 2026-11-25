import { apiErrorMessage, apiMessage } from "@/i18n/api-message";
import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/server-auth";
import { validateUploadFile } from "@/lib/upload-validation";
import { addPersonalMaterial, changePersonalLibrary, getPersonalLibrary, type LibraryAction } from "@/lib/canvas/personal-library";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  const user = await getUserId(req); if (!user) return NextResponse.json({ error: apiMessage("m48144f96c150") }, { status: 401 });
  try { return NextResponse.json({ success: true, library: await getPersonalLibrary(user) }, { headers: { "Cache-Control": "private, no-store" } }); }
  catch (e) { return NextResponse.json({ error: apiErrorMessage((e as Error).message) }, { status: 400 }); }
}
export async function POST(req: NextRequest) {
  const user = await getUserId(req); if (!user) return NextResponse.json({ error: apiMessage("m48144f96c150") }, { status: 401 });
  try {
    if ((req.headers.get("content-type") || "").startsWith("multipart/form-data")) {
      if (Number(req.headers.get("content-length")) > 205 * 1024 * 1024) throw new Error("单次上传文件过大");
      const form = await req.formData(), file = form.get("file");
      const folderId = String(form.get("folderId") || "").trim();
      if (!folderId) throw new Error("请先选择或新建上传文件夹");
      if (!(file instanceof File)) throw new Error("请选择文件");
      const validation = await validateUploadFile(file, ["image", "video", "audio"]);
      if (!validation.ok || !validation.kind) throw new Error(validation.error || "无效文件");
      const extensions: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp", "image/bmp": "bmp", "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov", "video/x-matroska": "mkv", "audio/mpeg": "mp3", "audio/mp3": "mp3", "audio/wav": "wav", "audio/x-wav": "wav", "audio/wave": "wav", "audio/vnd.wave": "wav", "audio/aac": "aac", "audio/ogg": "ogg", "audio/webm": "webm", "audio/flac": "flac", "audio/x-flac": "flac", "audio/mp4": "m4a", "audio/x-m4a": "m4a" };
      const extension = extensions[file.type.toLowerCase()]; if (!extension) throw new Error("不支持的文件类型");
      const item = await addPersonalMaterial(user, folderId, { name: file.name, kind: validation.kind, mime: file.type, size: file.size }, Buffer.from(await file.arrayBuffer()), extension);
      return NextResponse.json({ success: true, item });
    }
    const action = await req.json() as LibraryAction;
    return NextResponse.json({ success: true, library: await changePersonalLibrary(user, action) });
  } catch (e) { return NextResponse.json({ error: apiErrorMessage((e as Error).message) }, { status: 400 }); }
}
