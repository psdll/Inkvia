import fs from "node:fs";
import { describe, expect, it } from "vitest";

describe("Agent memory user deletion lifecycle", () => {
  it("removes the exact private .Agent file after whole-account deletion", () => {
    const source = fs.readFileSync("app/api/admin/user/delete/route.ts", "utf8");
    expect(source).toContain("deleteAgentMemoryDirectoryForUser");
    expect(source).toContain("resolveAgentMemoryFilePath");
    expect(source).not.toContain('fs.remove(resolveUploadsRootDirectory()');
  });

  it("keeps Agent conversations and memory as separate explicit purge scopes", () => {
    const route = fs.readFileSync("app/api/admin/user/purge-data/route.ts", "utf8");
    const modal = fs.readFileSync("components/admin/UserPurgeModal.tsx", "utf8");
    for (const field of ["purgeAgentConversations", "purgeAgentMemory"]) {
      expect(route).toContain(field);
      expect(modal).toContain(field);
    }
  });
});
