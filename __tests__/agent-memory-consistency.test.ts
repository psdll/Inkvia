import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";



describe(".Agent profile/file consistency", () => {
  it("casts PostgreSQL advisory lock results before Prisma deserializes them", () => {
    for (const file of [
      "lib/admin/legacy-agent-data/memory-profile-service.ts",
      "lib/admin/legacy-agent-data/memory-delete-service.ts",
      "lib/admin/legacy-agent-data/admin-delete-service.ts",
    ]) {
      const source = readFileSync(path.join(process.cwd(), file), "utf8");
      const locks = source.match(/SELECT pg_advisory_xact_lock\([^\n]+/g) || [];
      expect(locks.length, file).toBeGreaterThan(0);
      for (const lock of locks) expect(lock, file).toContain("::text");
    }
  });
});
