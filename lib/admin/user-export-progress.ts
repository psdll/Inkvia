const PACK_PROGRESS_START = 35;
const PACK_PROGRESS_END = 95;

export function computeExportPackProgress(bytesWritten: number, estimatedBytes: number) {
  if (!Number.isFinite(estimatedBytes) || estimatedBytes <= 0) return PACK_PROGRESS_START;
  const written = Number.isFinite(bytesWritten) ? Math.max(0, bytesWritten) : 0;
  const ratio = Math.min(1, written / estimatedBytes);
  return PACK_PROGRESS_START + Math.floor(ratio * (PACK_PROGRESS_END - PACK_PROGRESS_START));
}
