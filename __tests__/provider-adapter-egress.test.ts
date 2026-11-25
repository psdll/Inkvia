import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function read(relativePath: string) {
  return readFileSync(resolve(process.cwd(), relativePath), "utf8");
}

describe("provider adapters use the unified egress transport", () => {
  it.each([
    ["lib/kie.ts", "kie"],
    ["lib/jiekou-image.ts", "jiekou"],
    ["lib/volcengine.ts", "volcengine"],
    ["lib/seedance.ts", "volcengine"],
  ])("routes %s through provider transport for %s", (file, providerId) => {
    const source = read(file);

    expect(source).toContain("@/lib/providers/transport");
    expect(source).toContain(`\"${providerId}\"`);
    expect(source).not.toMatch(/\bawait\s+fetch\s*\(/);
    expect(source).not.toMatch(/\baxios\.(?:get|post|request)\s*\(/);
  });



  it("does not automatically retry KIE task creation and keeps timeout and status handling", () => {
    const source = read("lib/kie.ts");

    expect(source).toContain("const maxAttempts = 1");
    expect(source).toContain("createTask is non-idempotent");
    expect(source).toContain("timeout: 45000");
    expect(source.match(/validateStatus:\s*\(\)\s*=>\s*true/g)).toHaveLength(2);
  });

  it("keeps Seedance Axios error classification and per-operation timeouts", () => {
    const source = read("lib/seedance.ts");

    expect(source).toContain("axios.isAxiosError(error)");
    expect(source).toContain("timeout: 60000");
    expect(source).toContain("timeout: 30000");
  });
});
