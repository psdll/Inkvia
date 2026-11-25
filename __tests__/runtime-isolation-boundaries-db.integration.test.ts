import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getRuntimePolicy } from "@/lib/runtime-isolation";
const integration = process.env.RUN_P0_DB_TESTS === "1" ? it : it.skip;
function run(source: string, extra: Record<string, string> = {}) {
  const result = spawnSync(process.execPath, ["-e", source], { encoding: "utf8", timeout: 20000, env: { ...process.env, ...extra } });
  expect(result.status, result.stderr).toBe(0);
  return result.stdout;
}
describe("actual process filesystem and network boundaries", () => {
  integration("requires database identity before maintenance writes and permits only verified roots", () => {
    const scratch = fs.mkdtempSync(path.join(getRuntimePolicy().writableRoots[3], "boundary-"));
    try {
      expect(run(`const fs=require('node:fs'), path=require('node:path'), assert=require('node:assert/strict');
        const {createGuardedPrismaClient}=require('./scripts/lib/runtime-isolation.cjs');
        const db=createGuardedPrismaClient(); const inside=path.join(process.env.P0_SCRATCH,'inside.txt');
        assert.throws(()=>fs.writeFileSync(inside,'synthetic'), /ENV_IDENTITY_UNVERIFIED/);
        (async()=>{ await db.$queryRawUnsafe('SELECT 1'); fs.writeFileSync(inside,'synthetic');
          assert.throws(()=>fs.renameSync(inside,path.resolve('outside-p0-test.txt')), /ENV_PATH_OUTSIDE_ROOT/);
          assert.equal(fs.readFileSync(inside,'utf8'),'synthetic');
          assert.throws(()=>fs.rmSync(path.resolve('public/uploads'),{recursive:true}), /ENV_PATH_OUTSIDE_ROOT/);
          assert.throws(()=>require('node:http').get('http://127.0.0.1:1/'), /ENV_EGRESS_DENIED/);
          await assert.rejects(fetch('https://unapproved.invalid/'), /ENV_EGRESS_DENIED/);
          await db.$disconnect(); console.log('BOUNDARIES_VERIFIED');
        })().catch(()=>{console.error('BOUNDARY_CHECK_FAILED');process.exitCode=1;});`, { P0_SCRATCH: scratch })).toContain("BOUNDARIES_VERIFIED");
    } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
  });
  it("denies build-time database and direct network effects before connection", () => {
    expect(run(`process.env.INKVIA_RUNTIME_PROFILE='build';
      require('./scripts/lib/build-boundaries.cjs'); const assert=require('node:assert/strict');
      assert.throws(()=>require('node:http').get('http://127.0.0.1:1'), /BUILD_EXTERNAL_IO_DENIED/);
      (async()=>{await assert.rejects(fetch('https://unapproved.invalid'), /BUILD_EXTERNAL_IO_DENIED/); console.log('BUILD_NETWORK_DENIED');})().catch(()=>process.exitCode=1);`)).toContain("BUILD_NETWORK_DENIED");
  });
});
