import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(process.cwd(), "components/ui/prompt-rich-editor.tsx"),
  "utf8",
);
const themeSource = readFileSync(
  resolve(process.cwd(), "styles/theme-system.css"),
  "utf8",
);

describe("prompt asset suggestion selected style", () => {
  it("matches the reference menu and active-row surfaces in dark mode", () => {
    const start = source.indexOf("const AssetSuggestionList");
    const end = source.indexOf("function createAssetMentionExtension", start);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);

    const suggestionList = source.slice(start, end);

    expect(suggestionList).toContain(
      "dark:!bg-[var(--prompt-asset-menu-bg)]",
    );
    expect(suggestionList).toContain(
      'index === activeIndex ? "bg-[var(--panel-2)] dark:bg-[var(--prompt-asset-menu-active-bg)]" : "hover:bg-[var(--panel-2)]"',
    );
    expect(themeSource).toContain("--prompt-asset-menu-bg: #262626;");
    expect(themeSource).toContain("--prompt-asset-menu-active-bg: #3c3c3c;");
  });

  it("moves the active selection to the option under the mouse", () => {
    const start = source.indexOf("const AssetSuggestionList");
    const end = source.indexOf("function createAssetMentionExtension", start);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);

    const suggestionList = source.slice(start, end);

    expect(suggestionList).toContain(
      "onMouseEnter={() => setActiveIndex(index)}",
    );
  });
});
