import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("canvas worker executable entry", () => {
  it("runs under the project's CommonJS tsx configuration", () => {
    const cli = path.resolve("node_modules/tsx/dist/cli.mjs");
    const result = spawnSync(process.execPath, [
      cli,
      "--conditions=react-server",
      "scripts/canvas-worker.ts",
      "--role=invalid",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
      timeout: 15_000,
      env: process.env,
    });
    const output = `${result.stdout || ""}\n${result.stderr || ""}`;

    expect(output).toContain("invalid canvas worker role: invalid");
    expect(output).not.toContain("Top-level await is currently not supported");
  });
});
