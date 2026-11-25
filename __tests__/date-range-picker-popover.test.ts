import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(process.cwd(), "components/ui/date-range-picker.tsx"), "utf8");

describe("date range picker popover", () => {
  it("keeps two months in a compact panel", () => {
    expect(source).toContain("const popupWidth = Math.min(single ? 280 : 480");
    expect(source).not.toContain('sm:w-[590px]');
    expect(source).toContain('className={single ? "" : "grid grid-cols-2 gap-4"}');
    expect(source).toContain("renderMonth(viewMonth)");
    expect(source).toContain("renderMonth(addMonths(viewMonth, 1))");
  });

  it("renders outside clipping parents with fixed portal positioning", () => {
    expect(source).toContain('import { createPortal } from "react-dom"');
    expect(source).toContain('position: "fixed"');
    expect(source).toContain("popupRef.current?.contains(target)");
    expect(source).toContain("document.body");
  });

  it("offsets the panel right without allowing viewport overflow", () => {
    expect(source).toContain("const horizontalOffset = 32");
    expect(source).toContain("rect.right - popupWidth + horizontalOffset");
    expect(source).toContain("viewportWidth - popupWidth - viewportPadding");
  });
});
