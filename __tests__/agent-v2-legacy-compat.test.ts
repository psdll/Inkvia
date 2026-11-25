import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("Agent V2 final switch compatibility gate", () => {
  it("removes legacy Agent streaming and editable memory endpoints after the V2 UI switch", () => {
    for (const file of ["app/api/agent/chat/route.ts", "app/api/agent/memories/route.ts", "app/api/agent/memories/[id]/route.ts"]) {
      expect(fs.existsSync(path.join(process.cwd(), file)), file).toBe(false);
    }
  });

  it("keeps new database fields compatible with old writers", () => {
    const schema = fs.readFileSync(path.join(process.cwd(), "prisma/schema.prisma"), "utf8");
    expect(schema).toMatch(/kind\s+String\s+@default\("text"\)/);
    expect(schema).toMatch(/status\s+String\s+@default\("completed"\)/);
    expect(schema).toMatch(/sequence\s+Int\?/);
    expect(schema).toMatch(/requestKey\s+String\?\s+@unique/);
  });
});
