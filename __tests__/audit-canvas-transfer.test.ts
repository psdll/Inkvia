import { expect, it, vi } from 'vitest';
import { materializeCanvasTransferRecord, prepareCanvasArchiveRows } from '@/lib/canvas/transfer-record';
import { createEmptyCanvasDocumentV2 } from '@/lib/canvas/document';
const node = { id: 'new', type: 'prompt', position: { x: 15, y: 20 }, data: { kind: 'prompt', text: 'latest' } };
const original = () => ({ id: 1, data: createEmptyCanvasDocumentV2(), settings: { snapToGrid: false, gridSize: 20 }, revision64: BigInt("9007199254740993"), projectionRevision: BigInt("9007199254740993"), snapshotRevision: BigInt("1"), currentSnapshotId: BigInt("9"), nodeCount: 1, edgeCount: 0 });
const transaction = () => ({ canvasNodeState: { findMany: vi.fn(async () => [{ data: node }]) }, canvasEdgeState: { findMany: vi.fn(async () => []) } });
it('round trips current projected nodes with a lossless revision and fresh projection metadata', async () => {
  const exported = await materializeCanvasTransferRecord(transaction() as any, original() as any);
  const archive = JSON.parse(JSON.stringify([exported], (_, value) => typeof value === 'bigint' ? String(value) : value));
  const [restored] = prepareCanvasArchiveRows(archive, new Map());
  expect(restored.data.nodes).toEqual([node]);
  expect(restored.revision64).toBe(BigInt("9007199254740993"));
  expect(restored).toMatchObject({ projectionRevision: BigInt("0"), snapshotRevision: BigInt("0"), currentSnapshotId: null });
});
it('fails closed if projection counts or revisions are inconsistent', async () => {
  await expect(materializeCanvasTransferRecord(transaction() as any, { ...original(), nodeCount: 2 } as any)).rejects.toThrow('不完整');
  await expect(materializeCanvasTransferRecord(transaction() as any, { ...original(), projectionRevision: BigInt("2") } as any)).rejects.toThrow('版本不一致');
});
it('rejects old incomplete archives instead of restoring stale data', () => {
  expect(() => prepareCanvasArchiveRows([original()] as any, new Map())).toThrow('重新导出');
});
