import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (file: string) => readFileSync(resolve(process.cwd(), file), "utf8");

describe("canvas image editor grid guides", () => {
  it("renders each separator as one thin muted line without a dark halo", () => {
    const editor = read("components/canvas/ImageEditorModal.tsx");
    const gridOverlay = editor.slice(
      editor.indexOf('{mode === "grid" && ('),
      editor.indexOf('{mode === "grid" && (') + 900,
    );

    expect(gridOverlay).toContain('data-grid-guide-line={line.type}');
    expect(gridOverlay).toContain(
      '"absolute bg-[color-mix(in_srgb,var(--app-fg)_38%,var(--app-bg))]"',
    );
    expect(gridOverlay).toContain('"top-0 h-full w-px"');
    expect(gridOverlay).toContain('"left-0 h-px w-full"');
    expect(gridOverlay).not.toContain("shadow-[0_0_0_2px");
    expect(gridOverlay).not.toContain("bg-white/95");
  });
});
