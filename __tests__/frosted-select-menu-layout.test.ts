import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("FrostedSelect menu layout", () => {
  it("expands beyond a narrow trigger to fit the widest option", async () => {
    const select = await import("@/components/ui/frosted-select") as any;

    expect(typeof select.resolveFrostedSelectMenuWidth).toBe("function");
    expect(select.resolveFrostedSelectMenuWidth({
      buttonWidth: 128,
      widestLabelWidth: 98,
      viewportWidth: 2048,
      showLeading: true,
      compact: true,
    })).toBeGreaterThan(128);
  });

  it("keeps the expanded menu inside the viewport", async () => {
    const select = await import("@/components/ui/frosted-select") as any;

    expect(typeof select.resolveFrostedSelectMenuWidth).toBe("function");
    expect(select.resolveFrostedSelectMenuWidth({
      buttonWidth: 180,
      widestLabelWidth: 3_000,
      viewportWidth: 1_024,
      showLeading: true,
      compact: false,
    })).toBeLessThanOrEqual(1_000);
  });

  it("never applies ellipsis truncation to expanded menu options", () => {
    const source = readFileSync("components/ui/frosted-select.tsx", "utf8");
    const optionMarkup = source.slice(source.indexOf("{options.map"), source.indexOf("</button>", source.indexOf("{options.map")));

    expect(optionMarkup).toContain("whitespace-normal");
    expect(optionMarkup).toContain("break-words");
    expect(optionMarkup).not.toContain('truncateLabel ? "truncate"');
  });

  it("supports a short trigger label and grouped option presentation", () => {
    const source = readFileSync("components/ui/frosted-select.tsx", "utf8");
    expect(source).toContain("buttonLabel?: string");
    expect(source).toContain("depth?: number");
    expect(source).toContain("separatorBefore?: boolean");
    expect(source).toContain("selected?.buttonLabel || selected?.label");
  });

  it("supports fixed Canvas menu geometry without changing non-Canvas selects", () => {
    const source = readFileSync("components/ui/frosted-select.tsx", "utf8");

    expect(source).toContain("menuWidth?: number;");
    expect(source).toContain("menuMaxHeight?: number;");
    expect(source).toContain("optionHeight?: number;");
    expect(source).toContain("options.length * (optionHeight ?? 40) + 8");
    expect(source).toContain("minHeight: optionHeight");
    expect(source).toContain("leading-[18px]");
    expect(source).toContain("text-[11px] leading-4");
  });
});
