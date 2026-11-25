import { afterAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const temporary = mkdtempSync(path.join(os.tmpdir(), "p0-entrypoints-"));
afterAll(() => rmSync(temporary, { recursive: true, force: true }));
const deniedEnv = { ...process.env, INKVIA_RUNTIME_PROFILE: "local", INKVIA_RUNTIME_POLICY: path.join(temporary, "missing-policy.json"), DATABASE_URL: "postgresql://UNPRINTABLE_PASSWORD:UNPRINTABLE_PASSWORD@not-a-test.invalid/unsafe" };

describe("runtime entrypoint rejection before side effects", () => {
  it.each(["scripts/dev-preflight.cjs", "scripts/dev-migrate.cjs"])("rejects an unsupported profile in %s", script => {
    const result = spawnSync(process.execPath, [script, "--profile", "production"], { encoding: "utf8", timeout: 10000, env: deniedEnv });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("ENV_PROFILE_REQUIRED");
  });
  it.each(["--web-only", "--with-workers", ""])("rejects independent dev alias %s without starting Next or a worker", flag => {
    const result = spawnSync(process.execPath, ["scripts/next-runner.cjs", "dev", ...(flag ? [flag] : [])], { encoding: "utf8", timeout: 10000, env: deniedEnv });
    expect(result.status).toBe(1); expect(result.stderr).toContain("ENV_IDENTITY_UNVERIFIED");
    expect(result.stdout).not.toContain("ready"); expect(`${result.stdout}${result.stderr}`).not.toContain("UNPRINTABLE_PASSWORD");
  });
  it("never creates a migration/generate process after a rejected identity check", () => {
    const preload = path.join(temporary, "capture.cjs");
    writeFileSync(preload, `const cp=require('node:child_process'); const spawn=cp.spawnSync; cp.spawnSync=function(binary,args,options){if(args.some(value=>/prisma[/\\\\]build|generate-prisma/.test(value))){console.log('UNSAFE_MUTATION_CHILD'); return {status:90};} return spawn(binary,args,options);};`);
    const result = spawnSync(process.execPath, ["--require", preload, "scripts/dev-migrate.cjs"], { encoding: "utf8", timeout: 10000, env: deniedEnv });
    expect(result.status).toBe(1); expect(`${result.stdout}${result.stderr}`).not.toContain("UNSAFE_MUTATION_CHILD");
  });
  it.each(["scripts/canvas-worker.ts", "scripts/image-batch-worker.ts", "scripts/live-video-batch-worker.ts"])("rejects standalone %s before its first tick", script => {
    const tsx = require.resolve("tsx/cli");
    const role = script === "scripts/canvas-worker.ts" ? "generation" : "prompt";
    const result = spawnSync(process.execPath, [tsx, "--conditions=react-server", script, `--role=${role}`], { encoding: "utf8", timeout: 15000, env: deniedEnv });
    expect(result.status).not.toBe(0); expect(`${result.stdout}${result.stderr}`).toContain("ENV_IDENTITY_UNVERIFIED");
    expect(`${result.stdout}${result.stderr}`).not.toContain("UNPRINTABLE_PASSWORD");
  }, 20000);
  it("blocks a directly constructed maintenance client before business operations", () => {
    const result = spawnSync(process.execPath, ["scripts/backfill-admin-asset-feed.mjs"], { encoding: "utf8", timeout: 10000, env: deniedEnv });
    expect(result.status).not.toBe(0); expect(`${result.stdout}${result.stderr}`).toContain("ENV_IDENTITY_UNVERIFIED");
    expect(`${result.stdout}${result.stderr}`).not.toContain("UNPRINTABLE_PASSWORD");
  });
});
