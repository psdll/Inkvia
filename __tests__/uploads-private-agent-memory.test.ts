import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { isPrivateUploadPath } from "@/lib/private-upload-path";

describe("private upload path boundary", () => {
  it("blocks Agent memory and existing private Role Skill workspaces", () => {
    expect(isPrivateUploadPath(".agent-memory/users/7/.Agent")).toBe(true);
    expect(isPrivateUploadPath(".agent-memory\\users\\7\\.Agent")).toBe(true);
    expect(isPrivateUploadPath("role_skill_covers/users/7/workspaces/a/file.png")).toBe(true);
    expect(isPrivateUploadPath("image_results/ok.png")).toBe(false);
  });

  it("uses the same private-path guard for HEAD and GET", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "app/api/uploads/[...path]/route.ts"), "utf8");
    expect(source.match(/isPrivateUploadPath\(relative\)/g)).toHaveLength(2);
    expect(source).not.toContain("isPrivateRoleSkillWorkspace");
  });
});
