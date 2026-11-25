export type ReconcileBatch = {
  digest: string; scanned: number; nextCursor: number; hasMore: boolean;
  amountCny: string; updated: number;
  items: { id: number; model: string; before: string; after: string }[];
};
export type ReconcilePlan = { batches: { cursor: number; preview: ReconcileBatch }[]; scanned: number };
type Request = (action: "preview" | "apply", cursor: number, digest?: string) => Promise<ReconcileBatch>;

// Keep each transaction bounded, but scan the whole scope before asking for one confirmation.
export async function previewAll(request: Request, progress: (scanned: number) => void): Promise<ReconcilePlan> {
  const plan: ReconcilePlan = { batches: [], scanned: 0 };
  let cursor = 0;
  for (;;) {
    const preview = await request("preview", cursor);
    plan.batches.push({ cursor, preview });
    plan.scanned += preview.scanned;
    progress(plan.scanned);
    if (!preview.hasMore) return plan;
    if (preview.nextCursor <= cursor) throw new Error("补算分页未前进，请重新预览");
    cursor = preview.nextCursor;
  }
}

export async function applyAll(request: Request, plan: ReconcilePlan, progress: (updated: number) => void) {
  let updated = 0;
  for (const batch of plan.batches) {
    if (!batch.preview.items.length) continue;
    const result = await request("apply", batch.cursor, batch.preview.digest);
    updated += result.updated;
    progress(updated);
  }
  return updated;
}
