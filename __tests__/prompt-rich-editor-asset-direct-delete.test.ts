import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const promptEditorSource = readFileSync(
  resolve(process.cwd(), "components/ui/prompt-rich-editor.tsx"),
  "utf8",
);

describe("prompt rich editor asset deletion", () => {
  it("handles a plain @ before the asset suggestion plugin", () => {
    const editorProps = promptEditorSource.slice(
      promptEditorSource.indexOf("editorProps:"),
      promptEditorSource.indexOf("onUpdate({ editor })"),
    );

    expect(editorProps).toContain("handlePlainAtDeletion(view, event)");
  });

  it("deletes adjacent @asset mentions directly without selecting them first", () => {
    const assetMentionExtension = promptEditorSource.slice(
      promptEditorSource.indexOf("function createAssetMentionExtension"),
      promptEditorSource.indexOf("function RoleSkillMentionView"),
    );

    expect(assetMentionExtension).toContain("selectable: false");
    expect(assetMentionExtension).toContain("selectedOnTextSelection: false");
    expect(assetMentionExtension).toContain(
      'Backspace: () => deleteAdjacentInlineReference(this.editor, this.name, "backward")',
    );
    expect(assetMentionExtension).toContain(
      'Delete: () => deleteAdjacentInlineReference(this.editor, this.name, "forward")',
    );
  });

  it("deletes adjacent skill references directly without selecting them first", () => {
    const skillMentionView = promptEditorSource.slice(
      promptEditorSource.indexOf("function RoleSkillMentionView"),
      promptEditorSource.indexOf("function createRoleSkillMentionExtension"),
    );
    const skillMentionExtension = promptEditorSource.slice(
      promptEditorSource.indexOf("function createRoleSkillMentionExtension"),
      promptEditorSource.indexOf("function findRoleSkillMention"),
    );

    expect(skillMentionExtension).toContain("selectable: false");
    expect(skillMentionExtension).toContain("selectedOnTextSelection: false");
    expect(skillMentionExtension).toContain(
      'Backspace: () => deleteAdjacentInlineReference(this.editor, this.name, "backward")',
    );
    expect(skillMentionExtension).toContain(
      'Delete: () => deleteAdjacentInlineReference(this.editor, this.name, "forward")',
    );
    expect(skillMentionView).not.toContain("选中后");
  });
});
