import { readChineseUiSource as readFileSync } from "./helpers/chinese-ui-source";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(file: string) {
  return readFileSync(resolve(process.cwd(), file), "utf8");
}

describe("admin resumable import UI", () => {
  it("uploads fixed-size chunks with retry and persists the resumable upload id", () => {
    const page = source("app/admin/page.tsx");

    expect(page).toContain("IMPORT_UPLOAD_CHUNK_BYTES = 32 * 1024 * 1024");
    expect(page).toContain("IMPORT_UPLOAD_RETRIES = 3");
    expect(page).toContain("IMPORT_UPLOAD_RETRY_DELAY_MS");
    expect(page).toContain("file.slice(");
    expect(page).toContain('"x-upload-offset"');
    expect(page).toContain("localStorage");
    expect(page).toContain("window.setTimeout(resolveDelay, IMPORT_UPLOAD_RETRY_DELAY_MS * (attempt + 1))");
    expect(page).not.toContain("new FormData()");
    expect(page).not.toContain("new XMLHttpRequest()");
  });

  it("renders every different-content path conflict", () => {
    const modal = source("components/admin/ImportProgressModal.tsx");

    expect(modal).toContain("conflicts?: string[]");
    expect(modal).toContain("state.conflicts.map");
    expect(modal).toContain("冲突文件");
    expect(modal).toContain("overflow-y-auto");
  });
});
