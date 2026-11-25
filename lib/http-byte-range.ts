export type ByteRange = { start: number; end: number };

export function parseSingleByteRange(header: string, fileSize: number): ByteRange | null {
  if (!Number.isSafeInteger(fileSize) || fileSize <= 0) return null;
  const value = String(header || "").trim();
  if (!value.startsWith("bytes=") || value.includes(",")) return null;

  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2])) return null;

  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return null;
    return { start: Math.max(0, fileSize - suffixLength), end: fileSize - 1 };
  }

  const start = Number(match[1]);
  const requestedEnd = match[2] ? Number(match[2]) : fileSize - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(requestedEnd) || start >= fileSize) return null;
  const end = Math.min(requestedEnd, fileSize - 1);
  return start <= end ? { start, end } : null;
}
