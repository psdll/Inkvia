import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({
  publicRoot: "",
  systemReferences: 0,
  personalReferences: 0,
  deleteStoredMediaRefs: vi.fn(async () => ({ deletedLocalFiles: 1 })),
}));

vi.mock("@/lib/public-path", async () => {
  const pathModule = await import("node:path");
  return {
    resolvePublicPath: (...segments: string[]) => pathModule.join(fake.publicRoot, ...segments),
  };
});
vi.mock("@/lib/prisma", () => ({
  default: {
    systemRoleSkill: { count: vi.fn(async () => fake.systemReferences) },
    userRoleSkill: { count: vi.fn(async () => fake.personalReferences) },
  },
}));
vi.mock("@/lib/media-cleanup", () => ({
  deleteStoredMediaRefs: fake.deleteStoredMediaRefs,
}));

describe("role skill cover storage", () => {
  beforeAll(async () => {
    fake.publicRoot = await fs.mkdtemp(path.join(os.tmpdir(), "role-skill-covers-"));
  });

  afterAll(async () => {
    await fs.remove(fake.publicRoot);
  });

  beforeEach(() => {
    fake.systemReferences = 0;
    fake.personalReferences = 0;
    vi.clearAllMocks();
  });

  it("normalizes a personal image to a controlled account-owned WebP path", async () => {
    const source = await sharp({
      create: { width: 24, height: 18, channels: 3, background: "#336699" },
    }).png().toBuffer();
    const sourceBytes = new Uint8Array(source.length);
    sourceBytes.set(source);
    const file = new File([sourceBytes], "任意文件名.png", { type: "image/png" });
    const { saveRoleSkillCover } = await import("@/lib/role-skills/cover-storage");

    const coverUrl = await saveRoleSkillCover({
      file,
      scope: "personal",
      authUserId: 7,
    });

    expect(coverUrl).toMatch(
      /^\/uploads\/role_skill_covers\/users\/7\/[0-9a-f-]+\.webp$/,
    );
    const savedPath = path.join(fake.publicRoot, ...coverUrl.replace(/^\//, "").split("/"));
    const savedBytes = await fs.readFile(savedPath);
    expect((await sharp(savedBytes).metadata()).format).toBe("webp");
  });

  it("rejects spoofed image bytes and SVG declarations", async () => {
    const { saveRoleSkillCover } = await import("@/lib/role-skills/cover-storage");
    await expect(saveRoleSkillCover({
      file: new File(["not an image"], "fake.png", { type: "image/png" }),
      scope: "system",
    })).rejects.toThrow();
    await expect(saveRoleSkillCover({
      file: new File(["<svg/>"] , "unsafe.svg", { type: "image/svg+xml" }),
      scope: "system",
    })).rejects.toThrow();
  });

  it("does not delete a cover while another skill still references it", async () => {
    const { deleteRoleSkillCoverIfUnreferenced } = await import(
      "@/lib/role-skills/cover-storage"
    );
    fake.personalReferences = 1;
    const result = await deleteRoleSkillCoverIfUnreferenced(
      "/uploads/role_skill_covers/users/7/11111111-1111-4111-8111-111111111111.webp",
    );
    expect(result).toEqual({ deleted: false, referenced: true });
    expect(fake.deleteStoredMediaRefs).not.toHaveBeenCalled();
  });

  it("deletes only an unreferenced controlled cover", async () => {
    const { deleteRoleSkillCoverIfUnreferenced } = await import(
      "@/lib/role-skills/cover-storage"
    );
    const coverUrl = "/uploads/role_skill_covers/system/11111111-1111-4111-8111-111111111111.webp";
    await expect(deleteRoleSkillCoverIfUnreferenced(coverUrl)).resolves.toEqual({
      deleted: true,
      referenced: false,
    });
    expect(fake.deleteStoredMediaRefs).toHaveBeenCalledWith([coverUrl], { localOnly: true });
    await expect(deleteRoleSkillCoverIfUnreferenced("/uploads/../secret.webp")).rejects.toThrow();
  });
});
