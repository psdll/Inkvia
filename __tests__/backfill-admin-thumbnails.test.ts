import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { getThumbnailCacheKey } from "@/lib/thumbnail-cache";

describe("admin thumbnail backfill script", () => {
  const scriptPath = path.join(process.cwd(), "scripts/backfill-admin-thumbnails.mjs");

  it("documents every resumable and scoped CLI option", () => {
    const output = execFileSync(process.execPath, [scriptPath, "--help"], { encoding: "utf8" });
    for (const option of ["--days", "--admin-key", "--batch-size", "--dry-run", "--cursor"]) {
      expect(output).toContain(option);
    }
  });

  it("uses the same cache key as the request path", () => {
    const input = { sourcePath: "C:/uploads/example.png", sourceMtimeMs: 123.5, width: 600, quality: 88 };
    const code = [
      `import { getBackfillThumbnailCacheKey } from ${JSON.stringify(pathToFileURL(scriptPath).href)};`,
      `console.log(getBackfillThumbnailCacheKey(${JSON.stringify(input)}));`,
    ].join("\n");
    const actual = execFileSync(process.execPath, ["--input-type=module", "-e", code], { encoding: "utf8" }).trim();

    expect(actual).toBe(getThumbnailCacheKey(input));
  });

  it("uses id keyset pagination and prints the next cursor after each completed batch", () => {
    const source = fs.readFileSync(scriptPath, "utf8");
    expect(source).toContain("id: { gt: options.cursor }");
    expect(source).toContain('orderBy: { id: "asc" }');
    expect(source).toContain("nextCursor=");
  });

  it("supports the displayed thumbnail size with bounded background concurrency", () => {
    const code = `import { parseBackfillOptions } from ${JSON.stringify(pathToFileURL(scriptPath).href)}; console.log(JSON.stringify(parseBackfillOptions(['--width','300','--concurrency','1'])));`;
    const result = JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", code], { encoding: "utf8" }));
    expect(result.width).toBe(300);
    expect(result.concurrency).toBe(1);
  });

  it("prepares the same preferred source used by the card even if metadata keys have a different order", () => {
    const row = { localPath: '/uploads/original.png', templateData: JSON.stringify({ outputPreviewUrl: '/uploads/large.webp', outputThumbUrl: '/uploads/grid.webp' }) };
    const code = `import { selectGenerationImageSource } from ${JSON.stringify(pathToFileURL(scriptPath).href)}; console.log(selectGenerationImageSource(${JSON.stringify(row)}));`;
    expect(execFileSync(process.execPath, ["--input-type=module", "-e", code], { encoding: "utf8" }).trim()).toBe('/uploads/grid.webp');
  });
});
