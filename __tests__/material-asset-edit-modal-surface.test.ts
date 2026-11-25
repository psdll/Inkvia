import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const pageSource = readFileSync(resolve(process.cwd(), "app/admin/material-assets/page.tsx"), "utf8");
const globalsSource = readFileSync(resolve(process.cwd(), "app/globals.css"), "utf8");
const editModalSource = pageSource.match(/function MaterialAssetEditModal\([\s\S]*?\nfunction FileThumbnail/)?.[0] || "";

describe("material asset edit modal surface", () => {
  it("uses a solid dark panel surface instead of the translucent sidebar background", () => {
    expect(editModalSource).toContain("material-asset-edit-panel solid-panel-surface");
    expect(editModalSource).not.toContain("bg-[var(--sidebar-bg)]");
    expect(globalsSource).toContain("html.dark .material-asset-edit-panel");
    expect(globalsSource).toContain("--solid-panel-bg: var(--dropdown-panel-bg, #202020)");
  });
});
