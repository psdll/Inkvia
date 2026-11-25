import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const schema = read("prisma/schema.prisma");
const migration = read("prisma/migrations/20260715010000_add_material_asset_options/migration.sql");
const options = read("lib/material-asset-options.ts");
const uploadService = read("lib/material-asset-upload-service.ts");
const adminRoute = read("app/api/admin/material-assets/route.ts");
const optionRoute = read("app/api/material-assets/options/route.ts");
const selector = read("components/ui/suggest-select.tsx");
const adminUpload = read("app/admin/material-assets/page.tsx");
const settingsUpload = read("components/settings/material-upload-panel.tsx");

describe("material asset option library", () => {
  it("stores category, creator, and model candidates independently from material assets", () => {
    expect(schema).toContain("model MaterialAssetOption");
    expect(schema).toContain("@@unique([kind, value])");
    expect(schema).toContain("isDeleted Boolean  @default(false)");
    expect(migration).toContain('CREATE TABLE "MaterialAssetOption"');
    expect(migration).not.toContain('INSERT INTO "MaterialAssetOption"');
    expect(options).toContain("upsertMaterialAssetOptions");
    expect(options).toContain("mergeMaterialAssetOptionValues");
    expect(options).toContain("where: { isDeleted: false }");
    expect(options).not.toContain("materialAsset.update");
    expect(options).not.toContain("materialAsset.updateMany");
    expect(uploadService).toMatch(/normalizeMaterialAssetOptionValue\(\s*"creator"/);
    expect(uploadService).toContain("upsertMaterialAssetOptions");
    expect(adminRoute).toContain("listMaterialAssetOptionValues");
    expect(optionRoute).toContain("listMaterialAssetOptionValues");
  });

  it("deletes only candidate records through a protected endpoint", () => {
    expect(optionRoute).toContain("export async function DELETE");
    expect(optionRoute).toContain("requireAdminRequest(request).ok");
    expect(optionRoute).toContain("isMaterialUploadAllowed");
    expect(options).toContain("markMaterialAssetOptionDeleted");
    expect(optionRoute).toContain("markMaterialAssetOptionDeleted");
    expect(optionRoute).not.toContain("materialAssetOption.deleteMany");
    expect(optionRoute).not.toContain("materialAsset.update");
    expect(optionRoute).not.toContain("materialAsset.delete");
  });

  it("uses the same deletable selector in both upload entries and both upload modes", () => {
    expect(selector).toContain("onDeleteOption");
    expect(selector).toContain("Trash2");
    for (const source of [adminUpload, settingsUpload]) {
      expect(source).toContain('import { SuggestSelect } from "@/components/ui/suggest-select"');
      expect(source).toContain("onDeleteOption={");
      expect(source).not.toContain("function SuggestSelect(");
    }
    expect(settingsUpload).toContain("refreshOptionValues");
  });
});
