import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(file: string) {
  return readFileSync(resolve(process.cwd(), file), "utf8");
}

describe("admin user export integrity", () => {
  it("exports only the selected user's material download rows", () => {
    const builder = source("lib/admin/user-export-builder.ts");

    expect(builder).not.toContain("OR: [{ userId: effectiveAuthUserId }, { assetId: { in: materialAssetIds } }]");
    expect(builder).toContain("where: { userId: effectiveAuthUserId }");
    expect(builder).toContain("collectPathsFromValue(asset.media, filePaths)");
  });

  it("includes every user-owned workspace table in both export and import", () => {
    const builder = source("lib/admin/user-export-builder.ts");
    const runner = source("lib/admin/user-import-runner.ts");

    for (const model of ["canvasProject", "canvas", "canvasRun", "promptReverseTask"]) {
      expect(builder).toContain(`prisma.${model}.findMany`);
      expect(runner).toContain(`\"${model}\"`);
    }
    for (const entry of [
      "canvas_projects.json",
      "canvases.json",
      "canvas_runs.json",
      "prompt_reverse_tasks.json",
    ]) {
      expect(builder).toContain(entry);
      expect(runner).toContain(entry);
    }
    expect(builder).toContain("buildUserRoleSkillArchiveV1");
    expect(builder).toContain("data/user_role_skills.json");
    expect(builder).toContain("stringifyArchive(promptReverseTasks)");
    expect(builder).not.toContain("prisma.systemRoleSkill.findMany");
    expect(runner).toContain("restoreUserRoleSkillArchiveV1");
    expect(runner).toContain("data/user_role_skills.json");
    expect(runner).toContain("remapPromptReverseTaskRoleSkill");
  });

  it("ignores retired avatar records when reading older archives and still processes general upload entries", () => {
    const runner = source("lib/admin/user-import-runner.ts");
    const builder = source("lib/admin/user-export-builder.ts");
    const retiredMetadata = /virtualAvatar|VirtualAvatar|virtual_avatars/;

    expect(runner).not.toMatch(retiredMetadata);
    expect(builder).not.toMatch(retiredMetadata);
    expect(runner).toContain('else if (resolveFileTarget(name))');
    expect(runner).toContain('assertArchiveRowCount(manifest, "files", summary.fileEntries, "files")');
    expect(builder).toContain('collectPathsFromValue(td, filePaths)');
  });

  it("enables workspace data in the default export request", () => {
    const modal = source("components/admin/UserExportModal.tsx");
    const route = source("app/api/admin/user/export/route.ts");

    expect(modal).toContain("includeWorkspaceData: true");
    expect(route).toContain("workspaceData: asBool(body.includeWorkspaceData, d.workspaceData)");
  });
});
