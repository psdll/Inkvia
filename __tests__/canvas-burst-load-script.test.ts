import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("canvas burst load gate", () => {
  it("defines every frozen capacity tier without an unbounded client queue", () => {
    const source = readFileSync("scripts/canvas-burst-load.mjs", "utf8");
    expect(source).toContain("normal: { rps: 20");
    expect(source).toContain("peak: { rps: 100");
    expect(source).toContain("stress: { rps: 500");
    expect(source).toContain("overload: { rps: 1_000");
    expect(source).toContain("actor.busy");
    expect(source).toContain("clientDropped");
    expect(source).toContain("/bootstrap");
    expect(source).toContain("Retry-After");
  });
});
