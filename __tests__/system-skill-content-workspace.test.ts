import { readChineseUiSource as readFileSync } from "./helpers/chinese-ui-source";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  isMarkdownFileName,
  pickSkillMarkdownFile,
} from "@/lib/role-skills/skill-workspace";

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("system Skill content workspace", () => {
  it("finds SKILL.md in an uploaded directory and prefers the root file", () => {
    const nested = { name: "SKILL.md", webkitRelativePath: "demo/docs/SKILL.md" };
    const root = { name: "SKILL.md", webkitRelativePath: "demo/SKILL.md" };

    expect(pickSkillMarkdownFile([nested, root])).toBe(root);
    expect(pickSkillMarkdownFile([{ name: "README.md" }])).toBeNull();
  });

  it("accepts Markdown uploads case-insensitively", () => {
    expect(isMarkdownFileName("SKILL.md")).toBe(true);
    expect(isMarkdownFileName("skill.MD")).toBe(true);
    expect(isMarkdownFileName("skill.txt")).toBe(false);
  });

  it("uses a larger scoped scrollbar for the administrator content pane", () => {
    const workspace = source(
      "components/role-skills/system-skill-content-workspace.tsx",
    );
    const styles = source("app/globals.css");

    expect(
      workspace.match(/system-skill-workspace-content-scroll/g),
    ).toHaveLength(1);
    expect(workspace).toContain("system-skill-workspace flex");
    expect(styles).toContain(
      ".system-skill-workspace .system-skill-workspace-content-scroll::-webkit-scrollbar",
    );
    expect(styles).toContain("width: 16px");
    expect(styles).toContain("min-height: 56px");
  });

  it("uses the shared file workspace for writable system and personal Skills", () => {
    const editor = source("components/role-skills/role-skill-editor.tsx");
    const workspace = source("components/role-skills/system-skill-content-workspace.tsx");
    const sharedView = source("components/role-skills/role-skill-content-view.tsx");

    expect(editor).not.toContain('mode === "system-admin" ? (');
    expect(editor).toContain("<SystemSkillContentWorkspace");
    expect(editor).toContain("<SkillMarkdownEditor");
    expect(editor).toContain("disabled={readOnly}");
    expect(workspace).toContain("目录");
    expect(workspace).toContain("getSkillWorkspaceBaseName");
    expect(workspace).toContain("primary={workspace.primaryPath === file.path}");
    expect(workspace).toContain("上传");
    expect(workspace).toContain("SkillMarkdownEditor");
    expect(workspace).not.toContain("RoleSkillFormattedContent");
    expect(workspace).not.toContain("RoleSkillSourceContent");
    expect(sharedView).toContain("格式化预览");
    expect(sharedView).toContain("原始 Markdown");
    expect(workspace).toContain('aria-label={fullscreen ? "缩小" : "放大"}');
    expect(workspace).not.toContain("lineNumbers");
    expect(workspace).toContain("webkitdirectory");
    expect(workspace).not.toContain("Skill 内容优化");
    expect(workspace).toContain('aria-label="新建文件"');
    expect(workspace).toContain('aria-label="新建文件夹"');
    expect(workspace).not.toContain("ReactMarkdown");
    expect(workspace).not.toContain("remarkGfm");
    expect(workspace).toContain("var(--panel-bg)");
    expect(workspace).not.toMatch(/dark:bg-\[#/);
  });

  it("groups creation actions with the directory and import actions with the editor toolbar", () => {
    const workspace = source(
      "components/role-skills/system-skill-content-workspace.tsx",
    );
    const formatToggle = workspace.indexOf("<RoleSkillContentFormatToggle");
    const uploadMenu = workspace.indexOf('aria-haspopup="menu"');
    const directoryHeader = workspace.indexOf('title="选择根目录"');
    const directoryTree = workspace.indexOf(
      '<div className="h-[calc(100%-3rem)]',
    );
    const newFile = workspace.indexOf('aria-label="新建文件"');
    const newFolder = workspace.indexOf('aria-label="新建文件夹"');

    expect(formatToggle).toBeGreaterThan(-1);
    expect(uploadMenu).toBeGreaterThan(formatToggle);
    expect(uploadMenu).toBeLessThan(directoryHeader);
    expect(newFile).toBeGreaterThan(directoryHeader);
    expect(newFolder).toBeGreaterThan(directoryHeader);
    expect(newFile).toBeLessThan(directoryTree);
    expect(newFolder).toBeLessThan(directoryTree);
  });
});
