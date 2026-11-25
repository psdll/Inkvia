import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("development startup migrations", () => {
  it("applies committed migrations before generating the Prisma client", () => {
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8"),
    );

    expect(packageJson.scripts.predev).toBe(
      "node scripts/dev-migrate.cjs",
    );
  });
});
