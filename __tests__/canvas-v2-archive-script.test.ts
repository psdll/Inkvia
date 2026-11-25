import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const script = resolve(process.cwd(), "scripts/canvas-v2-archive.mjs");

describe("canvas v2 archive safety gate", () => {
  it("documents the required archive, verify, reset, and restore commands", () => {
    const result = spawnSync(process.execPath, [script, "help"], { encoding: "utf8" });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("archive --output");
    expect(result.stdout).toContain("verify --archive");
    expect(result.stdout).toContain("RESET_CANVAS_V2");
    expect(result.stdout).toContain("RESTORE_CANVAS_V2");
  });

  it("refuses reset before opening an archive when confirmation is absent", () => {
    const result = spawnSync(process.execPath, [script, "reset", "--archive", "missing.zip"], { encoding: "utf8" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("--confirm RESET_CANVAS_V2 is required");
  });

  it("rechecks the archived payload checksum immediately before reset", () => {
    const source = readFileSync(script, "utf8");
    expect(source).toContain("Database contents changed after archive; create a new archive before reset");
    expect(source).toContain("sha256(payloadText(currentPayload)) !== loaded.manifest.payloadSha256");
  });
});
