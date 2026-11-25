import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { readRuntimePolicy, assertNetworkTarget } from "../scripts/lib/runtime-isolation.cjs";
import { reserveRuntimeGeneration } from "@/lib/runtime-generation-budget";

const transaction = vi.hoisted(() => vi.fn(() => { throw new Error("Business must not access the test budget"); }));
vi.mock("@/lib/prisma", () => ({ default: { $transaction: transaction } }));

const roots: string[] = [];
function fixture() {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "business-runtime-")));
  roots.push(root);
  const uploads = path.join(root, "uploads");
  fs.mkdirSync(uploads);
  const file = path.join(root, "policy.json");
  const input = {
    schemaVersion: 1, profile: "local", projectRoot: root,
    database: { endpointId: "127.0.0.1:55432", databaseName: "synthetic", roleName: "synthetic", instanceId: "business-test" },
    writableRoots: [uploads], networkMode: "business", allowedTestOrigins: [],
  };
  fs.writeFileSync(file, JSON.stringify(input));
  const env = {
    INKVIA_RUNTIME_PROFILE: "local", INKVIA_RUNTIME_POLICY: file,
    DATABASE_URL: "postgresql://synthetic:unused@127.0.0.1:55432/synthetic", UPLOADS_DIR: uploads, APP_ROOT_DIR: root,
  };
  return { root, file, input, env, policy: readRuntimePolicy(env, root) };
}

afterEach(() => {
  transaction.mockClear();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("normal local business runtime", () => {
  it("allows providers, proxies and result origins without a test allowlist", () => {
    const { policy } = fixture();
    for (const url of ["https://provider.invalid/v1/models", "http://127.0.0.1:7890", "https://result-cdn.invalid/result.png"]) {
      expect(() => assertNetworkTarget(url, policy)).not.toThrow();
    }
    expect(() => assertNetworkTarget("file:///outside", policy)).toThrow("ENV_EGRESS_DENIED");
  });

  it("cannot turn a test or production profile into local business", () => {
    const f = fixture();
    for (const profile of ["test", "production"]) {
      fs.writeFileSync(f.file, JSON.stringify({ ...f.input, profile }));
      expect(() => readRuntimePolicy({ ...f.env, INKVIA_RUNTIME_PROFILE: profile }, f.root)).toThrow("ENV_TARGET_MISMATCH");
    }
    fs.writeFileSync(f.file, JSON.stringify(f.input));
    expect(() => readRuntimePolicy({ ...f.env, DATABASE_URL: "postgresql://wrong:unused@127.0.0.1:55432/wrong" }, f.root)).toThrow("ENV_TARGET_MISMATCH");
  });

  it("submits repeatedly without reading or consuming an old one-request test ceiling", async () => {
    const policy = { ...fixture().policy, testGenerationLimit: 1 };
    for (const key of ["image", "video", "audio", "canvas", "batch", "agent"]) {
      await expect(reserveRuntimeGeneration(key, policy)).resolves.toBeUndefined();
    }
    expect(transaction).not.toHaveBeenCalled();
  });

  it("keeps native file descriptors, temporary files, HTTP redirects and sockets usable", () => {
    const f = fixture();
    const boundaries = path.resolve("scripts/lib/runtime-boundaries.cjs");
    const result = spawnSync(process.execPath, ["-e", `
      const fs=require('node:fs'), http=require('node:http'), assert=require('node:assert/strict');
      require(${JSON.stringify(boundaries)}).installRuntimeBoundaries();
      const fd=fs.openSync('temporary-result.txt','w');
      fs.writeFileSync(fd,'result'); fs.closeSync(fd);
      assert.equal(fs.readFileSync('temporary-result.txt','utf8'),'result');
      const server=http.createServer((req,res)=>{
        if(req.url==='/redirect'){res.writeHead(302,{location:'/result'});res.end();}
        else {res.end('result');}
      });
      server.listen(0,'127.0.0.1',async()=>{
        try {
          const origin='http://127.0.0.1:'+server.address().port;
          assert.equal(await (await fetch(origin+'/redirect',{method:'POST',body:'synthetic'})).text(),'result');
          await new Promise((resolve,reject)=>http.get(origin+'/result',res=>{res.resume();res.on('end',resolve);}).on('error',reject));
          console.log('BUSINESS_IO_OK');
        } catch(error) {console.error(error);process.exitCode=1;}
        finally {server.closeAllConnections();server.close();}
      });
    `], { cwd: f.root, env: { ...process.env, ...f.env }, encoding: "utf8", timeout: 15000 });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("BUSINESS_IO_OK");
  }, 20000);
});
