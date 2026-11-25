/** Prepare legacy asset thumbnails off the request path. Dry run unless --apply is supplied. */
import prisma from "../lib/prisma";
import { createGenerationDisplayAssetPatch } from "../lib/generation-display-assets";
import { isAudioMediaUrl, isVideoMediaUrl } from "../lib/media-url";

async function main() {
  const apply = process.argv.includes("--apply");
  const afterArg = process.argv.find(arg => arg.startsWith("--after="));
  const limitArg = process.argv.find(arg => arg.startsWith("--limit="));
  let after = Math.max(0, Number(afterArg?.split("=")[1]) || 0);
  const limit = Math.min(10000, Math.max(1, Number(limitArg?.split("=")[1]) || 200));
  const stats = { apply, scanned: 0, missing: 0, updated: 0, failed: 0, nextAfter: after };
  while (stats.scanned < limit) {
    const rows = await prisma.generation.findMany({
      where: { id: { gt: after }, status: "success", localPath: { not: null }, type: { notIn: ["import", "audio_gen"] } },
      select: { id: true, type: true, localPath: true, templateData: true },
      orderBy: { id: "asc" }, take: Math.min(50, limit - stats.scanned),
    });
    if (!rows.length) break;
    for (const row of rows) {
      after = row.id; stats.nextAfter = after; stats.scanned++;
      let meta: Record<string, unknown> = {};
      try { meta = JSON.parse(row.templateData || "{}") || {}; } catch {}
      if (meta.outputThumbUrl || isAudioMediaUrl(row.localPath)) continue;
      stats.missing++;
      if (!apply) continue;
      try {
        const preview = [meta.outputPosterUrl, meta.outputPreviewUrl, meta.outputDisplayUrl]
          .find(value => typeof value === "string" && value && !isVideoMediaUrl(value));
        const generated = await createGenerationDisplayAssetPatch(preview
          ? { type: "image_edit", localPath: String(preview) }
          : row);
        if (!generated.outputThumbUrl) { stats.failed++; console.warn(`[work-thumbnail] ${row.id}: no thumbnail produced`); continue; }
        const patch = preview ? { outputThumbUrl: generated.outputThumbUrl } : generated;
        // Compare the original metadata: don't overwrite concurrent parameter updates or resurrect deleted rows.
        const updated = await prisma.generation.updateMany({
          where: { id: row.id, templateData: row.templateData },
          data: { templateData: JSON.stringify({ ...patch, ...meta, outputThumbUrl: patch.outputThumbUrl }) },
        });
        stats.updated += updated.count;
      } catch (error) { stats.failed++; console.warn(`[work-thumbnail] ${row.id}: ${error instanceof Error ? error.name : "media error"}`); }
    }
  }
  console.log(JSON.stringify(stats));
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Thumbnail backfill failed"); process.exitCode = 1; }).finally(() => prisma.$disconnect());
