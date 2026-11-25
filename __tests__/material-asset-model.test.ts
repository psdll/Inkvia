import { readChineseUiSource as readFileSync } from "./helpers/chinese-ui-source";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const schema = read("prisma/schema.prisma");
const uploadService = read("lib/material-asset-upload-service.ts");
const route = read("app/api/admin/material-assets/route.ts");
const adminUpload = read("app/admin/material-assets/page.tsx");
const settingsUpload = read("components/settings/material-upload-panel.tsx");

describe("material asset model", () => {
  it("persists and exposes model names from the material asset data source", () => {
    expect(schema).toContain("modelName        String?");
    expect(schema).toContain("@@index([modelName])");
    expect(uploadService).toContain('form.get("modelName")');
    expect(uploadService).toContain("modelName,");
    expect(route).toContain("modelName: asset.modelName || null");
    expect(route).toContain("listMaterialAssetOptionValues");
    expect(route).toContain("models:");
  });

  it("uses one server-backed, custom model selector in both upload entry points", () => {
    for (const source of [adminUpload, settingsUpload]) {
      expect(source).toContain("modelNameDraft");
      expect(source).toContain("modelName: string;");
      expect(source).toContain('form.set("modelName",');
      expect(source).toContain(">型号</label>");
      expect(source).toContain("options={modelOptions}");
    }
  });
});
