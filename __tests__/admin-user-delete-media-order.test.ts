import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("admin user deletion media safety", () => {
  it("does not run an unprotected local-file loop and deletes generation rows before protected media", () => {
    const source = readFileSync(resolve(process.cwd(), "app/api/admin/user/delete/route.ts"), "utf8");
    const generationDelete = source.indexOf("const deletedGenerations = await prisma.$transaction");
    const protectedMediaDelete = source.indexOf("const ossDeletion = await deleteStoredMediaRefs");

    expect(source).not.toContain("const diskPaths = Array.from(");
    expect(source).not.toContain("for (const p of diskPaths)");
    expect(generationDelete).toBeGreaterThan(-1);
    expect(protectedMediaDelete).toBeGreaterThan(generationDelete);
  });
});
