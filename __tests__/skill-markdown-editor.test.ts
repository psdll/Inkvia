import { existsSync } from "node:fs";
import { readChineseUiSource as readFileSync } from "./helpers/chinese-ui-source";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string) {
  const absolutePath = resolve(process.cwd(), path);
  return existsSync(absolutePath) ? readFileSync(absolutePath, "utf8") : "";
}

describe("Skill Markdown editor", () => {
  it("uses editable Tiptap Markdown and controlled external synchronization", () => {
    const preview = source(
      "components/role-skills/skill-markdown-preview-editor.tsx",
    );

    expect(preview).toContain('from "@tiptap/markdown"');
    expect(preview).toContain('contentType: "markdown"');
    expect(preview).toContain("editor.getMarkdown()");
    expect(preview).toContain("emitUpdate: false");
    expect(preview).toContain("editable: !disabled");
  });

  it("uses CodeMirror Markdown and dispatches external values without rebuilding", () => {
    const code = source(
      "components/role-skills/skill-markdown-code-editor.tsx",
    );

    expect(code).toContain('from "codemirror"');
    expect(code).toContain('from "@codemirror/lang-markdown"');
    expect(code).toContain("EditorView.updateListener.of");
    expect(code).toContain("update.docChanged");
    expect(code).toContain("view.dispatch");
    expect(code).toContain("view.destroy()");
  });

  it("offers labeled Preview and Code modes without writing content on toggle", () => {
    const editor = source(
      "components/role-skills/skill-markdown-editor.tsx",
    );
    const toggle = source(
      "components/role-skills/role-skill-content-view.tsx",
    );

    expect(editor).toContain("<RoleSkillContentFormatToggle");
    expect(editor).toContain('variant="editor"');
    expect(editor).toContain("<SkillMarkdownPreviewEditor");
    expect(editor).toContain("<SkillMarkdownCodeEditor");
    expect(editor).toContain("onChange={setMode}");
    expect(toggle).toContain('editorVariant ? "预览" : "格式化预览"');
    expect(toggle).toContain('editorVariant ? "代码" : "原始 Markdown"');
    expect(toggle).toContain("aria-pressed={active}");
  });

  it("declares the Markdown editor dependencies", () => {
    const packageJson = JSON.parse(source("package.json")) as {
      dependencies?: Record<string, string>;
    };

    expect(packageJson.dependencies?.["@tiptap/markdown"]).toBe(packageJson.dependencies?.["@tiptap/core"]);
    expect(packageJson.dependencies?.["@tiptap/markdown"]).toMatch(/^\^3\./);
    expect(packageJson.dependencies?.codemirror).toBeTruthy();
    expect(packageJson.dependencies?.["@codemirror/lang-markdown"]).toBeTruthy();
    expect(packageJson.dependencies?.["@codemirror/view"]).toBeTruthy();
  });
});
