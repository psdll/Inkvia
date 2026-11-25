import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Seedance 2.5 video page output format", () => {
  it("hides the output-format selector and always submits MP4", () => {
    const source = readFileSync("app/video/video-tool.tsx", "utf8");

    expect(source).not.toContain('label="输出格式"');
    expect(source).not.toContain('ariaLabel="输出格式"');
    expect(source).not.toContain("setOutputFormat");
    expect(source).not.toContain('form.set("outputFormat", outputFormat)');
    expect(source).toContain('form.set("outputFormat", "mp4")');
  });
});
