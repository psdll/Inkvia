import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Prisma client lifecycle", () => {
  it("deploys migrations before development and regenerates the client before development and production builds", () => {
    const packageJson = JSON.parse(readFileSync(resolve(process.cwd(), "package.json"), "utf8"));

    expect(packageJson.scripts?.predev).toBe("node scripts/dev-migrate.cjs");
    expect(packageJson.scripts?.prebuild).toBe("node scripts/generate-prisma-local.cjs");
    const migrate = readFileSync(resolve(process.cwd(), "scripts/dev-migrate.cjs"), "utf8");
    expect(migrate.indexOf('runtime-identity-check.cjs')).toBeLessThan(migrate.indexOf('const commands ='));
    expect(migrate).toContain('[["migrate", "deploy"], ["generate"]]');
  });
});
