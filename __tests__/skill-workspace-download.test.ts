import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import type { RoleSkillDetail } from "@/lib/role-skills/contracts";
import { buildSkillWorkspaceArchive } from "@/lib/role-skills/workspace-download";

const skill: RoleSkillDetail = {
  id: "system:1", source: "system", mediaType: "video", name: "视频技能",
  summary: "", category: "", coverUrl: null, usageScenario: "", usageGuide: "",
  revision: 1, createdAt: "", updatedAt: "", content: "旧正文",
};

describe("Skill ZIP export", () => {
  it("preserves the complete workspace, Unicode content and empty folders", async () => {
    const files = [
      { path: "SKILL.md", content: "# 视频技能\n正文\n" },
      { path: "LICENSE", content: "License text" },
      { path: "references/方法/说明.md", content: "中文内容 😀\n第二行" },
    ];
    const { blob, filename } = await buildSkillWorkspaceArchive({ ...skill, workspace: {
      primaryPath: "SKILL.md", directories: ["空文件夹"], files,
    } });
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    expect(filename).toBe("视频技能.zip");
    expect(blob.type).toBe("application/zip");
    expect(Object.values(zip.files).filter((file) => !file.dir)).toHaveLength(3);
    expect(zip.files["空文件夹/"].dir).toBe(true);
    for (const file of files) expect(await zip.file(file.path)!.async("string")).toBe(file.content);
  });

  it("exports legacy single-file Skills and sanitizes download names", async () => {
    const { blob, filename } = await buildSkillWorkspaceArchive({ ...skill, name: "技能/测试:*" });
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    expect(filename).toBe("技能_测试__.zip");
    expect(Object.keys(zip.files)).toEqual(["SKILL.md"]);
    expect(await zip.file("SKILL.md")!.async("string")).toBe("旧正文");
  });

  it("rejects paths outside the workspace", async () => {
    await expect(buildSkillWorkspaceArchive({ ...skill, workspace: {
      primaryPath: "../outside.md", directories: [], files: [{ path: "../outside.md", content: "" }],
    } })).rejects.toThrow("技能工作区路径无效");
  });
});
