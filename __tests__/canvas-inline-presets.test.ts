import { describe, expect, it } from "vitest";
import { CHARACTER_SHEET_TOKEN, withLegacyCreativeTokens } from "@/lib/canvas/creative-presets/inline-token";
import { composeCanvasCreativePrompt } from "@/lib/canvas/creative-presets/compose";
import { promptTextToEditorDoc, editorDocToPromptText } from "@/lib/prompt-rich-editor-content";

describe("inline creative presets", () => {
  it("silently drops retired style, filter and motion tags and selections from saved prompts", () => {
    const prompt = "[[style:style-643]]\n开场[[filter:filter-714]]人物走动[[motion:motion-645]]结尾";
    expect(withLegacyCreativeTokens(prompt)).toBe("开场人物走动结尾");
    expect(composeCanvasCreativePrompt({ kind: "video", prompt, creativePresets: { motionId: "motion-645" } })).toBe("开场人物走动结尾");
    expect(editorDocToPromptText(promptTextToEditorDoc(prompt, [], undefined, true))).toBe("开场人物走动结尾");
  });
  it("keeps the character-sheet tag as an editor mention through save and load", () => {
    const prompt = `开场${CHARACTER_SHEET_TOKEN}结尾`;
    const doc = promptTextToEditorDoc(prompt, [], undefined, true);
    expect(doc.content[0].content?.filter(node => node.type === "motionMention").map(node => node.attrs?.presetId)).toEqual(["characterSheet-0"]);
    expect(editorDocToPromptText(JSON.parse(JSON.stringify(doc)))).toBe(prompt);
  });
});
