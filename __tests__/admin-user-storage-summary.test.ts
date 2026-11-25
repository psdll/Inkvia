import { describe, expect, it } from "vitest";
import { buildAdminUserStorageSummary } from "@/lib/admin-user-storage-summary";

describe("admin user storage summary", () => {
  it("counts only local uploads and deduplicates physical paths", () => {
    const summary = buildAdminUserStorageSummary([
      { path: "/uploads/image_results/a.png", sizeBytes: 100, category: "generated" },
      { path: "/uploads/image_results/a.png", sizeBytes: 100, category: "privateLibrary" },
      { path: "uploads/imports/b.png?preview=1", sizeBytes: 50, category: "uploaded" },
      { path: "https://example.oss-cn-hangzhou.aliyuncs.com/uploads/imports/remote.png", sizeBytes: 999, category: "uploaded" },
    ]);

    expect(summary).toMatchObject({
      totalBytes: 150,
      generatedBytes: 100,
      uploadedBytes: 50,
      privateLibraryBytes: 0,
      fileCount: 2,
      verifiedFiles: 2,
      unverifiedFiles: 0,
      averageFileBytes: 75,
      largestFileBytes: 100,
    });
  });

  it("keeps unknown local files visible without distorting known-size averages", () => {
    const summary = buildAdminUserStorageSummary([
      { path: "/uploads/products/private/known.png", sizeBytes: 30, category: "privateLibrary" },
      { path: "/uploads/products/private/unknown-thumb.webp", sizeBytes: null, category: "privateLibrary" },
      { path: "/uploads/products/private/unknown-thumb.webp", sizeBytes: 0, category: "privateLibrary" },
    ]);

    expect(summary).toMatchObject({
      totalBytes: 30,
      privateLibraryBytes: 30,
      fileCount: 2,
      verifiedFiles: 1,
      unverifiedFiles: 1,
      averageFileBytes: 30,
      largestFileBytes: 30,
    });
  });

  it("uses the largest valid cached size when duplicate rows disagree", () => {
    const summary = buildAdminUserStorageSummary([
      { path: "/uploads/image_results/a.png", sizeBytes: null, category: "generated" },
      { path: "/uploads/image_results/a.png#asset", sizeBytes: 120, category: "privateLibrary" },
    ]);

    expect(summary).toMatchObject({
      totalBytes: 120,
      generatedBytes: 120,
      privateLibraryBytes: 0,
      fileCount: 1,
      verifiedFiles: 1,
      unverifiedFiles: 0,
      averageFileBytes: 120,
      largestFileBytes: 120,
    });
  });
});

