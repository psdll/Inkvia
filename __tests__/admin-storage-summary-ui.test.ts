import { readChineseUiSource as readFileSync } from "./helpers/chinese-ui-source";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("admin storage summary UI", () => {
  const source = readFileSync(
    resolve(process.cwd(), "components/admin/AdminOverviewTab.tsx"),
    "utf8",
  );
  const routeSource = readFileSync(
    resolve(process.cwd(), "app/api/admin/storage/route.ts"),
    "utf8",
  );
  const storageScanSource = readFileSync(
    resolve(process.cwd(), "lib/admin-storage-scan.ts"),
    "utf8",
  );

  it("labels recent production separately from the lifetime summary", () => {
    expect(source).toContain("近90天产出");
    expect(source).toContain("累计产出");
    expect(source).toContain("lifetimeGenerations");
    expect(source).not.toContain("总产出素材");
    expect(source).not.toContain("按总产出数");
  });

  it("shows ownership coverage and hides untrusted storage shares", () => {
    expect(source).toContain("capacityOwnership");
    expect(source).toContain("容量归属率不足");
    expect(source).toContain("capacityOwnership.complete");
  });

  it("labels tool and batch workbench folders explicitly", () => {
    expect(source).toContain('imports: "创作导入的素材"');
    expect(source).toContain('batch_imports: "批量导入的素材"');
    expect(source).toContain('"batch-image_results": "批量结果素材"');
    expect(source).toContain(
      'node.name === "imports" || node.name === "batch_imports"',
    );
    expect(storageScanSource).toContain(
      '"uploads/imports": { label: "创作导入的素材"',
    );
    expect(storageScanSource).toContain(
      '"uploads/batch_imports": { label: "批量导入的素材"',
    );
    expect(storageScanSource).toContain(
      '"uploads/batch-image_results": { label: "批量结果素材"',
    );
    expect(storageScanSource).toContain(
      "存放创作工具上传、导入及输入快照素材",
    );
  });

  it("renders upload directories in business sections", () => {
    expect(source).toContain('groupAdminStorageNodes(nodes)');
    expect(source).toContain("{group.label}");
    expect(source).toContain("{formatUiNumber(locale, group.count, undefined, () => formatCount(group.count))} 个目录");
    expect(source).toContain("{bytes(group.totalBytes, locale)}");
    expect(source).toContain("group.nodes.map((node) =>");
  });

  it("overrides stale imports purpose copy in the UI", () => {
    expect(source).toContain(
      'return "存放创作工具上传、导入及输入快照素材";',
    );
    expect(source).toContain("const purpose = resolveUploadDirPurpose(node);");
    expect(source).toContain("{purpose}");
  });

  it("prefixes tool generation result folders with the creation workspace name", () => {
    expect(storageScanSource).toContain(
      'folder: "image_results", label: "创作图片结果"',
    );
    expect(storageScanSource).toContain(
      'folder: "video_results", label: "创作视频结果"',
    );
    expect(routeSource).toContain(
      'folder: "image_results", label: "创作图片结果"',
    );
    expect(routeSource).toContain(
      'folder: "video_results", label: "创作视频结果"',
    );
  });

  it("shows the persistent voice preview cache as its own canvas directory", () => {
    for (const definition of [storageScanSource, routeSource]) {
      expect(definition).toContain(
        'folder: "canvas_voice_previews", label: "画布音色试听"',
      );
    }
    expect(storageScanSource).toContain(
      '"uploads/canvas_voice_previews": { label: "画布音色试听"',
    );
    expect(source).toContain('canvas_voice_previews: "画布音色试听"');
  });

  it("returns the read-model payload before the legacy Generation scan", () => {
    const readModelBranch = routeSource.indexOf("if (await isAdminSummaryReadModelReady())");
    const legacyScan = routeSource.indexOf("prisma.generation.findMany", readModelBranch);
    const branchReturn = routeSource.indexOf("return NextResponse.json", readModelBranch);
    expect(readModelBranch).toBeGreaterThan(0);
    expect(branchReturn).toBeGreaterThan(readModelBranch);
    expect(branchReturn).toBeLessThan(legacyScan);
  });
});
