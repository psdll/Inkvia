import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import { Readable } from "node:stream";
import { withPersonalMaterial } from "@/lib/canvas/personal-library";
import { personalMaterialDownloadName } from "@/lib/canvas/personal-library-types";
import sharp from "sharp";
import { thumbnailCache } from "@/lib/thumbnail-cache";
import { resolvePublicPath } from "@/lib/public-path";
export async function readPersonalMaterialResponse(req: NextRequest, user: number, id: string, readOnly = false) {
  const preview = req.nextUrl.searchParams.get("preview");
  if (preview && (req.nextUrl.searchParams.get("owner") !== String(user) || !["120", "600"].includes(preview))) return new NextResponse(null, { status: 404 });
  try {
    return await withPersonalMaterial(user, id, async (item, file) => {
      if (preview) {
        if (item.kind !== "image") return new NextResponse(null, { status: 415 });
        if (readOnly) {
          const buffer = await sharp(file, { failOn: "none" }).rotate().resize({ width: Number(preview), withoutEnlargement: true }).webp({ quality: 85 }).toBuffer();
          return new NextResponse(new Uint8Array(buffer), { headers: { "Content-Type": "image/webp", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
        }
        const stat = await fs.stat(file);
        const result = await thumbnailCache.ensureThumbnail({
          sourcePath: file, sourceMtimeMs: stat.mtimeMs, width: Number(preview), quality: 85,
          cacheDir: resolvePublicPath("uploads", "canvas-library", String(user), "_previews"),
          convert: () => sharp(file, { failOn: "none" }).rotate().resize({ width: Number(preview), withoutEnlargement: true }).webp({ quality: 85 }).toBuffer(),
        });
        // Private previews stay behind owner validation; the UI reuses its bounded memory cache.
        return new NextResponse(new Uint8Array(result.buffer), { headers: { "Content-Type": "image/webp", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
      }
      const handle = await fs.open(file, "r");
      try {
        const { size } = await handle.stat();
        const headers: Record<string, string> = { "Content-Type": item.mime, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Accept-Ranges": "bytes" };
        if (req.nextUrl.searchParams.has("download")) headers["Content-Disposition"] = `attachment; filename*=UTF-8''${encodeURIComponent(personalMaterialDownloadName(item))}`;
        let start = 0, end = size - 1;
        const range = req.headers.get("range");
        if (range) {
          const match = /^bytes=(\d*)-(\d*)$/.exec(range);
          if (!match || (!match[1] && !match[2])) { await handle.close(); return new NextResponse(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } }); }
          if (!match[1]) start = Math.max(0, size - Number(match[2]));
          else { start = Number(match[1]); end = match[2] ? Math.min(Number(match[2]), size - 1) : end; }
          if (start > end || start < 0 || start >= size) { await handle.close(); return new NextResponse(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } }); }
          headers["Content-Range"] = `bytes ${start}-${end}/${size}`;
        }
        headers["Content-Length"] = String(end - start + 1);
        return new NextResponse(Readable.toWeb(handle.createReadStream({ start, end, autoClose: true })) as ReadableStream, { status: range ? 206 : 200, headers });
      } catch (e) { await handle.close(); throw e; }
    }, readOnly);
  } catch { return new NextResponse(null, { status: 404 }); }
}
