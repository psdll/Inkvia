import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readRuntimePolicy, assertWritablePath, assertNetworkTarget, verifyDatabaseIdentity } from "../scripts/lib/runtime-isolation.cjs";

const roots: string[] = [];
function fixture() {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "p0-isolation-")));
  roots.push(root);
  const uploads = path.join(root, "uploads"); fs.mkdirSync(uploads);
  const database = { endpointId: "127.0.0.1:55432", databaseName: "synthetic", roleName: "synthetic", instanceId: "test-instance" };
  const file = path.join(root, "policy.json");
  const input = { schemaVersion: 1, profile: "test", projectRoot: root, database, writableRoots: [uploads], networkMode: "mock", allowedTestOrigins: [] };
  fs.writeFileSync(file, JSON.stringify(input));
  const env = { INKVIA_RUNTIME_PROFILE: "test", INKVIA_RUNTIME_POLICY: file, DATABASE_URL: "postgresql://synthetic:do-not-print@127.0.0.1:55432/synthetic", UPLOADS_DIR: uploads };
  return { root, uploads, file, input, env, policy: readRuntimePolicy(env, root) };
}
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

describe("runtime isolation", () => {
  it("pins the production standalone directory while retaining the installed application root", () => {
    const f = fixture();
    const runtimeRoot = path.join(f.root, ".next", "standalone");
    fs.mkdirSync(runtimeRoot, { recursive: true });
    fs.writeFileSync(f.file, JSON.stringify({ ...f.input, profile: "production", networkMode: "production", runtimeRoot }));
    const env = { ...f.env, INKVIA_RUNTIME_PROFILE: "production", APP_ROOT_DIR: f.root };
    expect(readRuntimePolicy(env, runtimeRoot).projectRoot).toBe(f.root);
    expect(readRuntimePolicy(env, f.root).projectRoot).toBe(f.root);
    expect(readRuntimePolicy({ ...env, APP_ROOT_DIR: undefined }, runtimeRoot).projectRoot).toBe(f.root);
    expect(() => readRuntimePolicy(env, path.join(runtimeRoot, "scripts"))).toThrow("ENV_TARGET_MISMATCH");
    expect(() => readRuntimePolicy({ ...env, APP_ROOT_DIR: runtimeRoot }, runtimeRoot)).toThrow("ENV_TARGET_MISMATCH");
    fs.writeFileSync(f.file, JSON.stringify({ ...f.input, runtimeRoot }));
    expect(() => readRuntimePolicy(f.env, runtimeRoot)).toThrow("ENV_TARGET_MISMATCH");
  });
  it("rejects an unpinned runtime directory or a standalone directory redirected by a junction", () => {
    const f = fixture();
    const runtimeRoot = path.join(f.root, ".next", "standalone");
    const outside = path.join(f.root, "other-release");
    fs.mkdirSync(outside); fs.mkdirSync(path.dirname(runtimeRoot));
    const env = { ...f.env, INKVIA_RUNTIME_PROFILE: "production" };
    const policy = { ...f.input, profile: "production", networkMode: "production", runtimeRoot: outside };
    fs.writeFileSync(f.file, JSON.stringify(policy));
    expect(() => readRuntimePolicy(env, outside)).toThrow("ENV_TARGET_MISMATCH");
    fs.symlinkSync(outside, runtimeRoot, "junction");
    fs.writeFileSync(f.file, JSON.stringify({ ...policy, runtimeRoot }));
    expect(() => readRuntimePolicy(env, runtimeRoot)).toThrow("ENV_TARGET_MISMATCH");
  });
  it("rejects unknown purpose and inherited database overrides without opening a connection", () => {
    const f = fixture();
    expect(() => readRuntimePolicy({ ...f.env, INKVIA_RUNTIME_PROFILE: "" }, f.root)).toThrow("ENV_PROFILE_REQUIRED");
    expect(() => readRuntimePolicy({ ...f.env, DATABASE_URL: "postgresql://live:SECRET@untrusted.invalid/live" }, f.root)).toThrow("ENV_TARGET_MISMATCH");
    expect(() => readRuntimePolicy({ ...f.env, DATABASE_URL: `${f.env.DATABASE_URL}?host=untrusted.invalid` }, f.root)).toThrow("ENV_TARGET_MISMATCH");
  });
  it("checks canonical ancestors, adjacent prefixes, and a junction replaced during runtime", () => {
    const f = fixture();
    expect(assertWritablePath(path.join(f.uploads, "new", "file.png"), f.policy)).toContain("file.png");
    expect(() => assertWritablePath(path.join(f.root, "uploads-other", "file"), f.policy)).toThrow("ENV_PATH_OUTSIDE_ROOT");
    const outside = path.join(f.root, "outside"); fs.mkdirSync(outside);
    const link = path.join(f.uploads, "link"); fs.symlinkSync(outside, link, "junction");
    expect(() => assertWritablePath(path.join(link, "file"), f.policy)).toThrow("ENV_PATH_OUTSIDE_ROOT");
    fs.unlinkSync(link); fs.mkdirSync(link);
    expect(assertWritablePath(path.join(link, "file"), f.policy)).toContain("file");
    fs.rmdirSync(link); fs.symlinkSync(outside, link, "junction");
    expect(() => assertWritablePath(path.join(link, "file"), f.policy)).toThrow("ENV_PATH_OUTSIDE_ROOT");
  });
  it("denies network by default and enforces exact origins for explicit tests", () => {
    const f = fixture();
    expect(() => assertNetworkTarget("https://provider.invalid", f.policy)).toThrow("ENV_EGRESS_DENIED");
    fs.writeFileSync(f.file, JSON.stringify({ ...f.input, networkMode: "explicit-test", allowedTestOrigins: ["https://test.invalid"], testGenerationLimit: 2 }));
    const policy = readRuntimePolicy(f.env, f.root);
    expect(() => assertNetworkTarget("https://test.invalid/api", policy)).not.toThrow();
    expect(() => assertNetworkTarget("https://test.invalid.attacker.invalid/api", policy)).toThrow("ENV_EGRESS_DENIED");
    expect(() => assertNetworkTarget("https://secret@test.invalid", policy)).toThrow("ENV_EGRESS_DENIED");
  });
  it("requires instance identity and restricted database privileges", async () => {
    const f = fixture();
    const row = { ...f.input.database, privileged: false, memberOfRole: false, otherDatabaseAccess: false };
    const client = { $queryRawUnsafe: async () => [row] } as unknown as Parameters<typeof verifyDatabaseIdentity>[0];
    await expect(verifyDatabaseIdentity(client, f.policy)).resolves.toMatchObject({ database: "verified" });
    row.instanceId = "different-instance";
    await expect(verifyDatabaseIdentity(client, f.policy)).rejects.toThrow("ENV_IDENTITY_UNVERIFIED");
    row.instanceId = f.input.database.instanceId; row.privileged = true;
    await expect(verifyDatabaseIdentity(client, f.policy)).rejects.toThrow("ENV_IDENTITY_UNVERIFIED");
  });
  it("build never performs database or application file/network I/O", async () => {
    const f = fixture();
    const policy = readRuntimePolicy({ INKVIA_RUNTIME_PROFILE: "build" }, f.root);
    const client = { $queryRawUnsafe: () => { throw new Error("must not connect"); } } as unknown as Parameters<typeof verifyDatabaseIdentity>[0];
    await expect(verifyDatabaseIdentity(client, policy)).rejects.toThrow("BUILD_EXTERNAL_IO_DENIED");
    expect(() => assertWritablePath(f.uploads, policy)).toThrow("BUILD_EXTERNAL_IO_DENIED");
    expect(() => assertNetworkTarget("https://test.invalid", policy)).toThrow("BUILD_EXTERNAL_IO_DENIED");
  });
});
