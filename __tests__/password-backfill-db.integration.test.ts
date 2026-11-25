import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import prisma from "@/lib/prisma";
import { getRuntimePolicy } from "@/lib/runtime-isolation";
import { revealUserCredential } from "@/lib/user-credentials";
const integration = process.env.RUN_P0_DB_TESTS === "1" ? it : it.skip;
const ids: number[] = [];
afterAll(async () => { vi.unstubAllEnvs(); if (ids.length) await prisma.user.deleteMany({ where: { id: { in: ids } } }); await prisma.$disconnect(); });
function invoke(id: number, flags: string[], environment = process.env) {
  const result = spawnSync(process.execPath, [require.resolve("tsx/cli"), "--conditions=react-server", "scripts/password-credentials-backfill.ts", `--user-id=${id}`, ...flags], { encoding: "utf8", timeout: 20000, env: environment });
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).not.toContain("isolated historical password");
  return JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1)!).counts;
}
describe("bounded credential maintenance and key recovery", () => {
  integration("inspects, dry-runs, applies and rotates one isolated account, then restores its key backup", async () => {
    const user = await prisma.user.create({ data: { username: `p0-backfill-${randomUUID()}`, password: " isolated historical password ", token: "synthetic-old-session" } }); ids.push(user.id);
    expect(invoke(user.id, ["--inspect"])).toMatchObject({ scanned: 1, plaintext: 1, changed: 0 });
    expect(invoke(user.id, ["--dry-run"])).toMatchObject({ scanned: 1, changed: 0, failed: 0 });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).credentialVersion).toBe(0);
    expect(invoke(user.id, ["--apply"])).toMatchObject({ changed: 1, failed: 0 });
    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.token).toBe("synthetic-old-session"); expect(revealUserCredential(row)).toBe(" isolated historical password ");
    const temporary = fs.mkdtempSync(path.join(getRuntimePolicy().writableRoots[3], "key-recovery-"));
    const keyFile = path.join(temporary, "keys.json");
    try {
      const keys = { ...JSON.parse(fs.readFileSync(process.env.PASSWORD_CIPHER_KEYRING_FILE!, "utf8")), "p0-rotated": randomBytes(32).toString("base64") };
      const backup = JSON.stringify(keys); fs.writeFileSync(keyFile, backup);
      expect(invoke(user.id, ["--apply", "--rotate"], { ...process.env, PASSWORD_CIPHER_KEYRING_FILE: keyFile, PASSWORD_CIPHER_ACTIVE_KEY_ID: "p0-rotated" })).toMatchObject({ changed: 1, failed: 0 });
      const rotated = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(rotated.credentialVersion).toBe(row.credentialVersion);
      vi.stubEnv("PASSWORD_CIPHER_KEYRING_FILE", keyFile);
      fs.writeFileSync(keyFile, "{}");
      expect(() => revealUserCredential(rotated)).toThrow("PASSWORD_CIPHER_KEY_UNAVAILABLE");
      fs.writeFileSync(keyFile, backup);
      expect(revealUserCredential(rotated)).toBe(" isolated historical password ");
    } finally { vi.unstubAllEnvs(); fs.rmSync(temporary, { recursive: true, force: true }); }
  }, 30000);
});
