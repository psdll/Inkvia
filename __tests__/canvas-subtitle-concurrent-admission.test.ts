import { describe, expect, it, vi } from 'vitest';
import { createEmptyCanvasDocumentV2 } from '@/lib/canvas/document';
import { createSubtitleRemovalNode } from '@/lib/canvas/subtitle-removal';
import { createQueuedCanvasRun } from '@/lib/canvas/run-queue';
vi.mock('server-only', () => ({}));

function database(activeNode = 'first', count = 1) {
  const node = createSubtitleRemovalNode('second', '字幕', '/uploads/source.mp4', { width: 1920, height: 1080 }, { mode: 'auto' });
  const tx = {
    $queryRaw: vi.fn(async (sql: any) => {
      const query = sql.strings.join('?');
      if (query.includes('pg_advisory')) return [];
      if (query.includes('FROM "Canvas" canvas')) return [{ id: 1, revision: 1, revision64: BigInt(1), projectionRevision: BigInt(1), canEdit: true, settings: createEmptyCanvasDocumentV2().settings }];
      if (query.includes('CanvasNodeState')) return [{ data: node }];
      if (query.includes('CanvasEdgeState')) return [];
      if (query.includes('"requestHash"')) return [];
      if (query.includes('AppSetting')) return [{ value: JSON.stringify({ successAt: new Date().toISOString() }) }];
      if (query.includes('COUNT(*)')) return [{ count }];
      if (query.includes('FROM "CanvasRun"')) return [{ id: 10, state: { nodeIds: [activeNode] } }];
      throw new Error(query);
    }),
    $executeRaw: vi.fn(async () => 1),
    canvasRun: { create: vi.fn(async () => ({ id: 11, status: 'queued', queuedAt: new Date() })) },
  };
  return { client: { $transaction: (fn: any) => fn(tx) } as any, tx, node };
}
const input = { canvasId: 1, authUserId: 1, scope: 'single' as const, nodeIds: ['second'], expectedRevision: '1' };
describe('subtitle task admission while other canvas jobs run', () => {
  it('queues a distinct subtitle output node without waiting for the first run', async () => {
    const { client, tx } = database();
    await expect(createQueuedCanvasRun(client, input)).resolves.toMatchObject({ id: 11 });
    expect(tx.canvasRun.create).toHaveBeenCalledOnce();
  });
  it('still rejects simultaneous runs targeting the same output node', async () => {
    const { client, tx } = database('second');
    await expect(createQueuedCanvasRun(client, input)).rejects.toMatchObject({ code: 'CANVAS_RUN_ACTIVE' });
    expect(tx.canvasRun.create).not.toHaveBeenCalled();
  });
  it('retains the per-user queue limit', async () => {
    const { client } = database('first', 20);
    await expect(createQueuedCanvasRun(client, input)).rejects.toMatchObject({ code: 'CANVAS_USER_QUEUE_LIMIT' });
  });
  it('keeps the workflow admission guard for ordinary workflow nodes', async () => {
    const { client, node } = database();
    if (node.data.kind === 'videoTask') delete node.data.subtitleRemoval;
    await expect(createQueuedCanvasRun(client, input)).rejects.toMatchObject({ code: 'CANVAS_RUN_ACTIVE' });
  });
});
