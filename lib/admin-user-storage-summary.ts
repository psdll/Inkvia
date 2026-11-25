export type AdminUserStorageCategory = "generated" | "uploaded" | "privateLibrary";

export type AdminUserStorageRow = {
  path: string | null | undefined;
  sizeBytes: number | null | undefined;
  category: AdminUserStorageCategory;
};

export type AdminUserStorageSummary = {
  totalBytes: number;
  generatedBytes: number;
  uploadedBytes: number;
  privateLibraryBytes: number;
  fileCount: number;
  verifiedFiles: number;
  unverifiedFiles: number;
  averageFileBytes: number;
  largestFileBytes: number;
};

function normalizeLocalUploadPath(value: string | null | undefined) {
  let normalized = String(value || "").trim().replaceAll("\\", "/");
  if (!normalized) return "";

  normalized = normalized.split(/[?#]/)[0].replace(/\/{2,}/g, "/");
  if (normalized.startsWith("uploads/")) normalized = `/${normalized}`;
  return normalized.startsWith("/uploads/") ? normalized : "";
}

function toKnownSize(value: number | null | undefined) {
  const size = Number(value);
  return Number.isFinite(size) && size > 0 ? Math.floor(size) : 0;
}

export function buildAdminUserStorageSummary(rows: AdminUserStorageRow[]): AdminUserStorageSummary {
  const files = new Map<string, { category: AdminUserStorageCategory; sizeBytes: number }>();

  for (const row of rows) {
    const path = normalizeLocalUploadPath(row.path);
    if (!path) continue;

    const sizeBytes = toKnownSize(row.sizeBytes);
    const existing = files.get(path);
    if (existing) {
      if (sizeBytes > existing.sizeBytes) existing.sizeBytes = sizeBytes;
      continue;
    }

    files.set(path, { category: row.category, sizeBytes });
  }

  const summary: AdminUserStorageSummary = {
    totalBytes: 0,
    generatedBytes: 0,
    uploadedBytes: 0,
    privateLibraryBytes: 0,
    fileCount: files.size,
    verifiedFiles: 0,
    unverifiedFiles: 0,
    averageFileBytes: 0,
    largestFileBytes: 0,
  };

  for (const file of files.values()) {
    if (file.sizeBytes <= 0) {
      summary.unverifiedFiles += 1;
      continue;
    }

    summary.totalBytes += file.sizeBytes;
    summary.verifiedFiles += 1;
    summary.largestFileBytes = Math.max(summary.largestFileBytes, file.sizeBytes);

    if (file.category === "generated") summary.generatedBytes += file.sizeBytes;
    if (file.category === "uploaded") summary.uploadedBytes += file.sizeBytes;
    if (file.category === "privateLibrary") summary.privateLibraryBytes += file.sizeBytes;
  }

  summary.averageFileBytes = summary.verifiedFiles
    ? Math.round(summary.totalBytes / summary.verifiedFiles)
    : 0;

  return summary;
}
