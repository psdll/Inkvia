import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("studio prompt preset positioning", () => {
  it("keeps the inline preset overlay positioned inside the expanded tool region", () => {
    const studio = readFileSync("app/studio/page.tsx", "utf8");
    const presets = readFileSync(
      "components/presets/preset-prompts.tsx",
      "utf8",
    );

    expect(presets).toContain('<div className="fixed inset-0 z-[100]">');
    expect(studio).toContain(
      'toolboxCollapsed ? "overflow-hidden pointer-events-none" : "overflow-visible translate-x-0"',
    );
  });
});
