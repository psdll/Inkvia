import { readChineseUiSource as readFileSync } from "./helpers/chinese-ui-source";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(file: string) {
  return readFileSync(resolve(process.cwd(), file), "utf8");
}

describe("large user export reliability", () => {
  it("reports ZIP progress from bytes actually written", async () => {
    const progress = await import("@/lib/admin/user-export-progress").catch(() => null) as any;
    expect(typeof progress?.computeExportPackProgress).toBe("function");
    if (typeof progress?.computeExportPackProgress !== "function") return;

    expect(progress.computeExportPackProgress(0, 10_000)).toBe(35);
    expect(progress.computeExportPackProgress(5_000, 10_000)).toBe(65);
    expect(progress.computeExportPackProgress(10_000, 10_000)).toBe(95);
    expect(progress.computeExportPackProgress(20_000, 10_000)).toBe(95);
  });

  it("parses resumable byte ranges for large downloads", async () => {
    const ranges = await import("@/lib/http-byte-range").catch(() => null) as any;
    expect(typeof ranges?.parseSingleByteRange).toBe("function");
    if (typeof ranges?.parseSingleByteRange !== "function") return;

    expect(ranges.parseSingleByteRange("bytes=100-199", 1_000)).toEqual({ start: 100, end: 199 });
    expect(ranges.parseSingleByteRange("bytes=900-", 1_000)).toEqual({ start: 900, end: 999 });
    expect(ranges.parseSingleByteRange("bytes=-100", 1_000)).toEqual({ start: 900, end: 999 });
    expect(ranges.parseSingleByteRange("bytes=1000-", 1_000)).toBeNull();
    expect(ranges.parseSingleByteRange("bytes=0-1,4-5", 1_000)).toBeNull();
  });

  it("keeps long-running exports alive and removes the 20-minute UI cutoff", () => {
    const runner = source("lib/admin/user-export-runner.ts");
    const page = source("app/admin/page.tsx");

    expect(runner).toContain("USER_EXPORT_HEARTBEAT_MS");
    expect(runner).toContain("setInterval");
    expect(page).not.toContain("20 * 60 * 1000");
    expect(page).toContain("24 * 60 * 60 * 1000");
  });

  it("streams real byte progress and supports Range responses", () => {
    const builder = source("lib/admin/user-export-builder.ts");
    const download = source("app/api/admin/user/export/download/route.ts");

    expect(builder).toContain("output.bytesWritten");
    expect(builder).not.toContain('await emit("pack", 92)');
    expect(download).toContain('"Accept-Ranges": "bytes"');
    expect(download).toContain('"Content-Range"');
    expect(download).toContain("parseSingleByteRange");
  });

  it("shows the server-configured export limit in the export dialog", () => {
    const route = source("app/api/admin/user/export/route.ts");
    const modal = source("components/admin/UserExportModal.tsx");

    expect(route).toContain("getMaxExportBytes");
    expect(route).toContain("maxExportBytes");
    expect(modal).toContain("单次导出上限");
  });

  it("enforces the configured limit against the completed ZIP bytes", () => {
    const builder = source("lib/admin/user-export-builder.ts");

    expect(builder).toContain("stat.size > maxExportBytes");
    expect(builder).toContain("最终 ZIP 超过上限");
  });
});
