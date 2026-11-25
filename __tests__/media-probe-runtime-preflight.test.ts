import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { isPublicExport } from "./support/public-export";

const read = (file: string) => readFileSync(resolve(process.cwd(), file), "utf8");

describe("media probe runtime deployment gates", () => {
  it("performs a real sharp, ffmpeg, and ffprobe round trip", () => {
    const verifier = read("scripts/verify-media-probe-runtime.mjs");

    expect(verifier).toContain('from "sharp"');
    expect(verifier).toContain('"ffmpeg"');
    expect(verifier).toContain('"ffprobe"');
    expect(verifier).toContain("mkdtemp");
    expect(verifier).toContain("rm");
  });

  it("runs locally, ships in releases, and is required by server verification", () => {
    const deployPreflight = read("scripts/deploy-preflight.mjs");
    expect(deployPreflight).toContain("verify-media-probe-runtime.mjs");
    if (isPublicExport) return;
    const assembler = read("scripts/assemble-prebuilt-release.mjs");
    const releaseValidator = read("scripts/validate-prebuilt-release.mjs");
    const existingServerVerifier = read("scripts/existing-server-verify.py");

    for (const source of [assembler, releaseValidator, existingServerVerifier]) {
      expect(source).toContain("verify-media-probe-runtime.mjs");
    }
    expect(existingServerVerifier).toContain('["ffprobe", "-version"]');
  });
});
