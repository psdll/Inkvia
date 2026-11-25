import { apiErrorMessage, apiMessage } from "@/i18n/api-message";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { saveRemoteFile, saveUploadedFile } from "@/lib/storage";
import { copyUploadPathToImports } from "@/lib/generation/input-snapshot";
import { getUserId } from "@/lib/server-auth";
import { upsertAdminAssetFeedForGenerationId } from "@/lib/admin-asset-feed";

function isLocalUploadPath(value: string) {
  return value.startsWith("/uploads/") || value.startsWith("uploads/");
}

function isUploadedFile(value: FormDataEntryValue | null): value is File {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<File>;
  return (
    typeof candidate.name === "string" &&
    typeof candidate.type === "string" &&
    typeof candidate.arrayBuffer === "function"
  );
}

export async function POST(req: NextRequest) {
  const authUserId = await getUserId(req);
  if (!authUserId) {
    return NextResponse.json({ success: false, error: apiMessage("mc1986431234d") }, { status: 401 });
  }

  const formData = await req.formData();
  const file = formData.get("file");
  const sourceUrl = String(formData.get("sourceUrl") || "").trim();
  const userId = String(authUserId);

  try {
    let localPath = "";
    let recordPrompt = "";

    if (isUploadedFile(file)) {
      if (!file.type.startsWith("image/") && !file.type.startsWith("video/") && !file.type.startsWith("audio/")) {
        return NextResponse.json({ success: false, error: apiMessage("m0a1daf0bd1b5") }, { status: 400 });
      }
      localPath = await saveUploadedFile(file, "imports");
      recordPrompt = file.name;
    } else if (sourceUrl) {
      // 本地 /uploads/... 来源（产品库/素材库等）：从磁盘复制一份到 imports/，与源目录解耦；
      // 远端 http(s)/data: 来源：照旧下载到 imports/。
      localPath = isLocalUploadPath(sourceUrl)
        ? await copyUploadPathToImports(sourceUrl)
        : await saveRemoteFile(sourceUrl, "imports");
      recordPrompt = sourceUrl;
    } else {
      return NextResponse.json({ error: apiMessage("m42aebf3e10c9") }, { status: 400 });
    }

    const record = await prisma.generation.create({
      data: {
        userId,
        authUserId,
        type: "import",
        prompt: recordPrompt,
        status: "success",
        localPath,
        model: "upload"
      } as any
    });
    void upsertAdminAssetFeedForGenerationId(record.id).catch(() => null);

    return NextResponse.json({ success: true, data: record });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: apiErrorMessage(e?.message || apiMessage("m01aaebc96af1")) }, { status: 500 });
  }
}
