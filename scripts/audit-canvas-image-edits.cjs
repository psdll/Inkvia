// Read-only audit of retained editor outputs; never prints prompts or media URLs.
require('@next/env').loadEnvConfig(process.cwd(), true);
const { createGuardedPrismaClient } = require('./lib/runtime-isolation.cjs');
const db = createGuardedPrismaClient();
async function main() {
  const target = new URL(process.env.DATABASE_URL);
  const result = await db.$transaction(async tx => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    const canvases = await tx.canvas.findMany({ select: { id: true, authUserId: true, data: true } });
    const projected = await tx.canvasNodeState.findMany({ where: { kind: 'image' }, select: { canvasId: true, nodeId: true, width: true, height: true, data: true } });
    const assets = await tx.mediaAsset.findMany({ where: { OR: [
      { originalName: { in: ['brush.png', 'mask.png', 'crop.png', 'outpaint.png'] } },
      { originalName: { startsWith: 'grid_' } },
    ] }, select: { ownerUserId: true, originalName: true, status: true } });
    const owners = new Map(canvases.map(c => [c.id, c.authUserId]));
    const nodes = new Map();
    for (const c of canvases) for (const n of c.data?.nodes || []) nodes.set(`${c.id}:${n.id}`, { ...n, canvasId: c.id });
    for (const n of projected) nodes.set(`${n.canvasId}:${n.nodeId}`, { ...n.data, canvasId: n.canvasId });
    const summary = {};
    for (const label of ['裁剪', '扩图', '遮罩', '画笔', '宫格']) {
      const found = [...nodes.values()].filter(n => n.data?.kind === 'image' && n.data?.name === label);
      summary[label] = { nodes: found.length, users: [...new Set(found.map(n => owners.get(n.canvasId)))],
        defaultFrame: found.filter(n => n.width === 280 && n.height === 240).length,
        missingDimensions: found.filter(n => !n.data.variants?.original?.width || !n.data.variants?.original?.height).length };
    }
    const uploads = {};
    for (const a of assets) {
      const mode = a.originalName.startsWith('grid_') ? 'grid' : a.originalName.replace('.png', '');
      const key = `${a.ownerUserId}:${mode}:${a.status}`;
      uploads[key] = (uploads[key] || 0) + 1;
    }
    return { canvases: canvases.length, summary, uploads };
  }, { timeout: 60000 });
  console.log(JSON.stringify({ database: { host: target.hostname, port: target.port, name: target.pathname }, ...result }, null, 2));
}
main().catch(e => { console.error(e.code || e.name, e.message?.replace(/postgres(?:ql)?:\/\/\S+/g, '[redacted]')); process.exitCode = 1; }).finally(() => db.$disconnect());
