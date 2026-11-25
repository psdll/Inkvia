import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("audio asset entrypoints", () => {
  it("plays audio instead of passing it to an image in the shared lightbox", () => {
    const source = readFileSync("components/ui/media-lightbox.tsx", "utf8");
    expect(source.includes('kind === "audio"')).toBe(true);
    expect(source.includes("<audio")).toBe(true);
  });
  it("labels audio tasks consistently in administrator metadata", () => {
    for (const file of ["app/admin/page.tsx", "app/api/admin/user/route.ts"]) {
      expect(readFileSync(file, "utf8").includes('=== "audio_gen"')).toBe(true);
    }
  });
  it("hides audio template reuse in the list view as well as skipping inspiration lookup", () => {
    const source = readFileSync("app/works/page.tsx", "utf8");
    const actionIndex = source.indexOf("onClick={() => applyTemplate(it)}");
    expect(actionIndex).toBeGreaterThan(0);
    expect(source.slice(actionIndex - 220, actionIndex).includes('kind !== "audio"')).toBe(true);
    const detailStart = source.indexOf("const openDetail =");
    expect(source.slice(detailStart, source.indexOf("void (async", detailStart)).includes('item.type === "audio_gen"')).toBe(true);
  });
  it.each(["app/works/page.tsx", "components/admin/UserWorksPanel.tsx", "components/ui/media-assets-drawer.tsx"])("offers audio classification and artwork in %s", (file) => {
    const source = readFileSync(file, "utf8");
    expect(source.includes('key: "audio"')).toBe(true);
    expect(source.includes("audio_gen")).toBe(true);
    expect(source.includes("<Music2")).toBe(true);
  });
});
