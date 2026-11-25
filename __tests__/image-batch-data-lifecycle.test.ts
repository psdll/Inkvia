import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (file: string) => readFileSync(file, "utf8");

describe("image batch data lifecycle", () => {
  it("makes creation the Works default while preserving compatibility filters", () => {
    const assets = read("app/api/assets/route.ts");
    const works = read("app/works/page.tsx");
    expect(assets).toContain("CREATION_ASSET_SOURCES");
    expect(assets).toContain('if (source === "creation")');
    expect(assets).toContain('if (source === "tool_canvas")');
    expect(works).toContain('React.useState<AssetSourceFilterValue>(() => worksPreferences.get(userId)?.source || "creation")');
    expect(works).toContain("<AssetSourceSelect");
  });

  it("streams successful results as a zip without buffering image files", () => {
    const route = "app/api/image-batches/[batchId]/download/route.ts";
    expect(existsSync(route)).toBe(true);
    const source = read(route);
    expect(source).toContain('from "yazl"');
    expect(source).toContain("createReadStream");
    expect(source).toContain("addReadStreamLazy");
    expect(source).not.toContain("readFile(");
    expect(source).toContain("selectLatestSuccessfulBatchOutputs");
    expect(source).not.toContain('where: { status: "success"');
    expect(source).toContain('searchParams.get("outputId")');
    expect(source).toContain('"Content-Disposition"');
    expect(source).toContain('searchParams.get("groupId")');
    expect(source).toContain("validateBatchGroupDownloadName");
    expect(source).toContain('import { resolveUploadsRootDirectory } from "@/lib/storage";');
    expect(source).toContain("path.resolve(resolveUploadsRootDirectory())");
    expect(source).not.toContain("resolvePublicDir");
    expect(source).toContain("where: groupId ? { groupId } : undefined");
    expect(source).toContain(
      "batchGroupOutputName(groupName, files.length + 1, extension)",
    );
    expect(source).toContain("batchGroupArchiveName(groupName)");
    expect(source).not.toContain("safePart(batch.name");
  });

  it("exports and imports all five batch datasets in foreign-key order", () => {
    const exporter = read("lib/admin/user-export-builder.ts");
    const importer = read("lib/admin/user-import-runner.ts");
    const names = ["image_batches", "image_batch_groups", "image_batch_items", "image_batch_media", "image_batch_outputs"];
    names.forEach((name) => {
      expect(exporter).toContain(`data/${name}.json`);
      expect(importer).toContain(`data/${name}.json`);
    });
    expect(importer.indexOf('"imageBatch",')).toBeLessThan(importer.indexOf('"imageBatchGroup",'));
    expect(importer.indexOf('"imageBatchGroup",')).toBeLessThan(importer.indexOf('"imageBatchItem",'));
    expect(importer.indexOf('"imageBatchItem",')).toBeLessThan(importer.indexOf('"imageBatchMedia",'));
    expect(importer.indexOf('"imageBatchMedia",')).toBeLessThan(importer.indexOf('"imageBatchOutput",'));
  });

  it("deletes batch relations before owned media and unlinks purged outputs", () => {
    const accountDelete = read("lib/admin-user-delete.ts");
    const purge = read("app/api/admin/user/purge-data/route.ts");
    expect(accountDelete.indexOf("client.imageBatch.deleteMany")).toBeLessThan(accountDelete.indexOf("client.mediaAsset.deleteMany"));
    expect(purge.indexOf("deleteGenerationRowsAndBatchCards")).toBeGreaterThan(-1);
  });

  it("exports, imports and deletes workspace drafts in foreign-key order", () => {
    const exporter = read("lib/admin/user-export-builder.ts");
    const importer = read("lib/admin/user-import-runner.ts");
    const deletion = read("lib/admin-user-delete.ts");
    const purge = read("app/api/admin/user/purge-data/route.ts");
    for (const name of ["tool_workspace_drafts", "tool_workspace_draft_media"]) {
      expect(exporter).toContain(`data/${name}.json`);
      expect(importer).toContain(`data/${name}.json`);
    }
    expect(importer.indexOf('"toolWorkspaceDraft",')).toBeLessThan(
      importer.indexOf('"toolWorkspaceDraftMedia",'),
    );
    expect(deletion.indexOf("toolWorkspaceDraft.deleteMany")).toBeLessThan(
      deletion.indexOf("mediaAsset.deleteMany"),
    );
    expect(purge).toContain("toolWorkspaceDraftMedia.findMany");
    expect(purge).toContain("imageBatchMedia.findMany");
  });
});
