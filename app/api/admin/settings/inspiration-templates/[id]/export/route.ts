import { apiErrorMessage, apiMessage } from "@/i18n/api-message";
import { NextRequest, NextResponse } from "next/server";
import { requireAdminRequest } from "@/lib/admin-auth";
import { buildSingleTemplatePackageBufferById } from "@/app/api/admin/settings/inspiration-templates/_package";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = requireAdminRequest(req);
  if (!auth.ok) return NextResponse.json({ success: false, error: apiErrorMessage(auth.error) }, { status: 401 });

  const id = Number(params.id);
  if (!Number.isFinite(id)) return NextResponse.json({ success: false, error: apiMessage("m37b0cea26f1a") }, { status: 404 });
  let pack;
  try {
    pack = await buildSingleTemplatePackageBufferById(id);
  } catch (e: any) {
    return NextResponse.json({ success: false, error: apiErrorMessage(String(e?.message || "导出失败")) }, { status: 404 });
  }
  // pack.buffer 为 Uint8Array，运行时是合法 body；
  // 此处断言绕过 @types/node 22 与 DOM lib 的 Uint8Array 泛型不一致
  return new NextResponse(pack.buffer as unknown as BodyInit, {
    status: 200,
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(pack.fileName)}`,
      "cache-control": "no-store"
    }
  });
}
