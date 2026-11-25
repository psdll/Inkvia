import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("history generation sweep continuity", () => {
  it("fills the generation stage and clips the sweep within that stage", () => {
    const styles = readFileSync("app/globals.css", "utf8");
    const start = styles.indexOf(".history-generating-indicator {");
    const end = styles.indexOf(".history-generating-indicator__grid", start);
    const indicator = styles.slice(start, end);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    expect(indicator).toContain("overflow: hidden;");
    expect(indicator).toContain("isolation: isolate;");
    expect(indicator).toContain("contain: layout paint;");
    expect(indicator).toContain("width: 100%;");
    expect(indicator).toContain("height: 100%;");
    expect(indicator).not.toContain("animation:");
    const movingLight = styles.slice(styles.indexOf(".history-generating-indicator__sweep {"), styles.indexOf(".history-generating-indicator__corners {"));
    expect(movingLight).toContain("will-change: transform;");
    const sweep = styles.slice(styles.indexOf("@keyframes history-generating-sweep"), styles.indexOf("@media (prefers-reduced-motion: reduce)", styles.indexOf("@keyframes history-generating-sweep")));
    expect(sweep).toContain("transform: translateX(-110%);");
    expect(sweep).toContain("transform: translateX(260%);");
    expect(sweep).not.toMatch(/(?:width|height|left|top|filter):/);
  });
});
