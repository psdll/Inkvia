import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("studio status capacity probe", () => {
  it("is authenticated, jittered, configurable, and read-only", () => {
    const path = resolve(process.cwd(), "scripts/studio-status-load.mjs");
    expect(existsSync(path)).toBe(true);
    const source = readFileSync(path, "utf8");

    expect(source).toContain('STUDIO_LOAD_BASE_URL || "http://127.0.0.1:3000"');
    expect(source).toContain("STUDIO_LOAD_COOKIE");
    expect(source).toContain("STUDIO_LOAD_CLIENTS || \"30\"");
    expect(source).toContain("/api/history?view=status&source=all");
    expect(source).toContain("Math.random() * 2_000");
    expect(source).toContain("1_800 + Math.random() * 400");
    expect(source).toContain("STUDIO_LOAD_MAX_P95_MS");
    expect(source).not.toMatch(/method:\s*["'](?:POST|PUT|PATCH|DELETE)["']/);
    expect(source).not.toContain("console.log(cookie)");
  });
});
