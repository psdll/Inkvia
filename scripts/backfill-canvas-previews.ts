/** Dry run by default. Prepares derivative files only; never rewrites canvas documents. */
import prisma from "../lib/prisma";
import { prepareCanvasPreviews } from "../lib/canvas/prepare-previews";
import { readCanvasBootstrapPage } from "../lib/canvas/prisma-mutation-store";

async function main() {
  const apply = process.argv.includes("--apply");
  const arg = (name: string, fallback: number) => Number(process.argv.find(value => value.startsWith(`--${name}=`))?.split("=")[1]) || fallback;
  const limit = Math.max(1, Math.min(1000, arg("limit", 100)));
  let after = Math.max(0, arg("after", 0));
  const stats = { apply, canvases: 0, sources: 0, prepared: 0, failed: 0, legacyProjections: 0, initialized: 0, nextAfter: after };
  const seen = new Set<string>();
  while (stats.canvases < limit) {
    const rows = await prisma.canvas.findMany({ where: { id: { gt: after }, deletedAt: null, data: { path: ["mode"], equals: "smart" } }, select: { id: true, authUserId: true, data: true, projectionRevision: true }, orderBy: { id: "asc" }, take: Math.min(10, limit - stats.canvases) });
    if (!rows.length) break;
    for (const row of rows) {
      after = row.id; stats.nextAfter = after; stats.canvases++;
      if (row.projectionRevision === BigInt(0)) stats.legacyProjections++;
      if (apply && process.argv.includes("--initialize") && row.projectionRevision === BigInt(0)) {
        // Reuse the transactional, revision-checked initialization used by normal entry.
        const result = await readCanvasBootstrapPage(prisma, { canvasId: row.id, actorUserId: row.authUserId, limit: 1 });
        if (result.kind === "ok") stats.initialized++;
      }
      const nodes = row.projectionRevision === BigInt(0) ? [row.data] : (await prisma.canvasNodeState.findMany({ where: { canvasId: row.id }, select: { data: true } })).map(node => node.data);
      const stack: unknown[] = nodes;
      while (stack.length) {
        const value = stack.pop();
        if (typeof value === "string") {
          if (!value.startsWith("/uploads/") || !/\.(png|jpg|jpeg|webp|gif|bmp|tiff|avif|mp4|mov|webm|mkv)$/i.test(value) || seen.has(value)) continue;
          seen.add(value); stats.sources++;
          if (apply) {
            try { stats.prepared += await prepareCanvasPreviews(value); }
            catch { stats.failed++; }
          }
          if (stats.sources % 50 === 0) console.log(JSON.stringify(stats));
        } else if (Array.isArray(value)) stack.push(...value);
        else if (value && typeof value === "object") stack.push(...Object.values(value));
      }
    }
    console.log(JSON.stringify(stats));
  }
  console.log(JSON.stringify(stats));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
