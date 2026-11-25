import { readChineseUiSource as readFileSync } from "./helpers/chinese-ui-source";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(process.cwd(), "app/video/video-tool.tsx"),
  "utf8",
);

function sourceBetween(startMarker: string, endMarker: string) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);

  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);

  return source.slice(start, end);
}

describe("video parameter selected styles", () => {
  it("uses the shared group-card option grid for resolution and audio", () => {
    expect(source).toContain('import { ParamCardSections, ParamOptionGrid } from "@/components/parameters/param-cards";');
    expect(source).toContain('ariaLabel={parameterLabel("分辨率")}');
    expect(source).not.toContain("function SegmentedControl");
  });

  it("uses the same neutral selected surface for enabled switches", () => {
    const toggleRow = sourceBetween(
      "function ToggleRow",
      "function ParameterField",
    );

    expect(toggleRow).toContain(
      "border-[var(--app-fg)] bg-[var(--panel-3)] shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]",
    );
    expect(toggleRow).not.toContain("bg-blue-600");
  });
});
