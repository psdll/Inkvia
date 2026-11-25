import { existsSync } from "node:fs";
import { readChineseUiSource as readFileSync } from "./helpers/chinese-ui-source";
import { describe, expect, it } from "vitest";

const read = (path: string) => {
  expect(existsSync(path), `${path} must exist`).toBe(true);
  return readFileSync(path, "utf8");
};

describe("canvas unified prompt picker", () => {
  it("uses the shared effective list and dynamic category navigation", () => {
    const picker = read("components/canvas/PromptTemplatePicker.tsx");

    expect(picker).toContain("usePromptPresets()");
    expect(picker).not.toContain("/api/canvas/templates");
    expect(picker).toContain("categories.map");
    expect(picker).toContain("preset.category");
    expect(picker).toContain("preset.name");
    expect(picker).toContain("preset.content");
  });

  it("offers the same create, edit, and delete actions without source visuals", () => {
    const picker = read("components/canvas/PromptTemplatePicker.tsx");

    expect(picker).toContain("createPreset");
    expect(picker).toContain("updatePreset");
    expect(picker).toContain("deletePreset");
    expect(picker).not.toContain("source ===");
    expect(picker).not.toContain("内置");
    expect(picker).not.toContain("<select");
  });

  it("applies one whole content string and closes immediately", () => {
    const picker = read("components/canvas/PromptTemplatePicker.tsx");
    const board = read("components/canvas/SmartCanvasBoard.tsx");

    expect(picker).toMatch(
      /onApply\(preset\.content\);\s*onClose\(\);/,
    );
    expect(board).toContain(
      "const applyTemplate = React.useCallback((content: string) =>",
    );
    expect(board).toContain("setTemplateNodeId(null)");
  });

  it("removes the legacy split prompt and parameter UI", () => {
    const picker = read("components/canvas/PromptTemplatePicker.tsx");
    const route = read("app/api/canvas/templates/route.ts");

    for (const legacy of [
      "参数建议",
      "只填正向",
      "完整应用",
      "positive",
      "negative",
      "params",
    ]) {
      expect(picker).not.toContain(legacy);
    }
    expect(route).toContain("{ status: 410 }");
    expect(route).toContain("/api/prompt-presets");
  });
});
