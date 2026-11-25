import { apiErrorMessage, apiMessage } from "@/i18n/api-message";
import { NextRequest, NextResponse } from "next/server";
import JSZip from "jszip";
import { requireAdminRequest } from "@/lib/admin-auth";
import { buildSingleTemplatePackageBufferById } from "@/app/api/admin/settings/inspiration-templates/_package";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeBatchName() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  return `templates-batch-${y}${m}${d}-${hh}${mm}.zip`;
}

export async function POST(req: NextRequest) {
  const auth = requireAdminRequest(req);
  if (!auth.ok) return NextResponse.json({ success: false, error: apiErrorMessage(auth.error) }, { status: 401 });

  const body = (await req.json().catch(() => null)) as any;
  const idsRaw = Array.isArray(body?.ids) ? body.ids : [];
  const ids: number[] = Array.from(
    new Set<number>(idsRaw.map((x: any) => Number(x)).filter((x: number) => Number.isFinite(x)))
  );
  if (!ids.length) return NextResponse.json({ success: false, error: apiMessage("mad613b9fb3ae") }, { status: 400 });
  if (ids.length > 100) return NextResponse.json({ success: false, error: apiMessage("mc4ec6bedec7d") }, { status: 400 });

  const zip = new JSZip();
  const exported: Array<{ id: number; title: string; fileName: string }> = [];
  const failed: Array<{ id: number; error: string }> = [];
  for (const id of ids) {
    try {
      const pack = await buildSingleTemplatePackageBufferById(id);
      const entry = `templates/${pack.fileName}`;
      zip.file(entry, pack.buffer);
      exported.push({ id: pack.id, title: pack.title, fileName: pack.fileName });
    } catch (e: any) {
      failed.push({ id, error: String(e?.message || "导出失败") });
      continue;
    }
  }
  if (!exported.length) return NextResponse.json({ success: false, error: apiMessage("m1942b416f108") }, { status: 404 });

  zip.file(
    "manifest.json",
    JSON.stringify(
      {
        type: "inspiration_templates_batch",
        version: 1,
        exportedAt: new Date().toISOString(),
        requestedCount: ids.length,
        successCount: exported.length,
        failedCount: failed.length,
        items: exported
      },
      null,
      2
    )
  );
  zip.file(
    "export-report.json",
    JSON.stringify(
      {
        requestedIds: ids,
        successCount: exported.length,
        failedCount: failed.length,
        failed
      },
      null,
      2
    )
  );

  const buffer = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 6 } });
  const filename = safeBatchName();
  // Uint8Array<ArrayBufferLike> 与 DOM BodyInit 的泛型在 @types/node 22 下不匹配，
  // 运行时 Next.js 完全支持该 body，此处做一次明确断言。
  return new NextResponse(buffer as unknown as BodyInit, {
    status: 200,
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "x-export-requested-count": String(ids.length),
      "x-exported-count": String(exported.length),
      "x-export-failed-count": String(failed.length),
      "x-export-failed-ids": failed.map((x) => String(x.id)).join(","),
      "cache-control": "no-store"
    }
  });
}
