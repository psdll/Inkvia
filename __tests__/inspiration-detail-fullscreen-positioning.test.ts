import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(process.cwd(), "components/templates/inspiration-detail-fullscreen.tsx"), "utf8");

describe("inspiration detail fullscreen positioning", () => {
  it("covers the complete browser viewport", () => {
    expect(source).toContain('className="fixed inset-0 z-[120]');
    expect(source).not.toContain('style={{ left: 72, top: "var(--global-notice-height, 0px)" }}');
  });
});
