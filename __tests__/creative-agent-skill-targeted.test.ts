import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs-extra";
import os from "node:os";
import path from "node:path";
const mock = vi.hoisted(() => ({ root: "", system: vi.fn(), personal: vi.fn() }));
vi.mock("@/lib/storage", () => ({ resolveLocalUploadDirectory: () => mock.root }));
vi.mock("@/lib/prisma", () => ({ default: { systemRoleSkill: { findFirst: mock.system }, userRoleSkill: { findFirst: mock.personal } } }));
import { readCreativeSkill } from "@/lib/creative-agent/skill-packages";
const row = { id: BigInt(3), name: "selected", content: "fallback", revision: 5, status: "published", createdAt: new Date(), updatedAt: new Date() };
beforeEach(async () => {
  mock.root = await fs.mkdtemp(path.join(os.tmpdir(), "task5-skill-"));
  mock.system.mockResolvedValue(row); mock.personal.mockResolvedValue(row);
  await fs.ensureDir(path.join(mock.root, "references"));
  await fs.writeFile(path.join(mock.root, "SKILL.md"), "main body");
  await fs.writeFile(path.join(mock.root, "references/one.md"), "requested");
  await fs.writeFile(path.join(mock.root, "references/two.md"), "must not read");
});
afterEach(async () => { vi.restoreAllMocks(); await fs.remove(mock.root); });
describe("targeted authorized skill documents", () => {
  it("reads only the requested reference body and retains listed paths", async () => {
    const read = vi.spyOn(fs, "readFile");
    const result = await readCreativeSkill(7, "system:3", "references/one.md", 5);
    expect(result.content).toBe("requested"); expect(result.files).toContain("SKILL.md");
    const bodies = read.mock.calls.map(c => String(c[0])).filter(p => p.endsWith(".md"));
    expect(bodies).not.toContain(path.join(mock.root, "references/two.md"));
    expect(bodies).not.toContain(path.join(mock.root, "SKILL.md"));
  });
  it("rejects revision mismatch before reading bodies", async () => {
    const read = vi.spyOn(fs, "readFile");
    await expect(readCreativeSkill(7, "system:3", "references/one.md", 4)).rejects.toMatchObject({ code: "SKILL_REVISION_CONFLICT" });
    expect(read).not.toHaveBeenCalled();
  });
  it("rechecks publication and ownership and rejects traversal and symlinks", async () => {
    mock.system.mockResolvedValueOnce(null);
    await expect(readCreativeSkill(7, "system:3")).rejects.toMatchObject({ code: "SKILL_UNAVAILABLE" });
    mock.personal.mockResolvedValueOnce(null);
    await expect(readCreativeSkill(8, "personal:3")).rejects.toMatchObject({ code: "SKILL_UNAVAILABLE" });
    expect(mock.personal.mock.calls[0][0].where.authUserId).toBe(8);
    await expect(readCreativeSkill(7, "system:3", "../secret", 5)).rejects.toThrow();
    await fs.symlink(path.join(mock.root, "SKILL.md"), path.join(mock.root, "references/link.md"));
    await expect(readCreativeSkill(7, "system:3", "references/link.md", 5)).rejects.toThrow();
  });
});
