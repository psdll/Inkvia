import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("material series download", () => {
  it("uses one server-generated ZIP download instead of triggering every image in the browser", () => {
    const helperPath = resolve(process.cwd(), "lib/material-asset-download.ts");
    expect(existsSync(helperPath)).toBe(true);

    const helper = readFileSync(helperPath, "utf8");
    const route = readFileSync(resolve(process.cwd(), "app/api/material-assets/[id]/download/route.ts"), "utf8");
    const page = readFileSync(resolve(process.cwd(), "app/materials/page.tsx"), "utf8");

    expect(route).toContain("export async function GET");
    expect(route).toContain("materialSeriesZipResponse");
    expect(route).toContain("singleMaterialFileResponse");
    expect(helper).toContain('"content-type": "application/zip"');
    expect(route).toContain("downloadUrl");
    expect(page).toContain("json?.downloadUrl");
    expect(page).not.toContain("urls.forEach((url, index)");
  });
});
