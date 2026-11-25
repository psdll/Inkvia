export function retentionCutoffWhere(cutoff: Date) {
  return {
    OR: [
      { restoredAt: { lt: cutoff } },
      { restoredAt: null, createdAt: { lt: cutoff } },
    ],
  };
}
