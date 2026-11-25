import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("video parameter summary", () => {
  it("shows the selected model name before the input mode", () => {
    const source = readFileSync("app/video/video-tool.tsx", "utf8");

    expect(source).toContain(
      '`${modelSpec.label} · ${modelSpec.provider === "kie" ? "" :',
    );
  });
});
