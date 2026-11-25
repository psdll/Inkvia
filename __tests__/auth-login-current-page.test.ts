import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  join(process.cwd(), "components/auth/AuthProvider.tsx"),
  "utf8",
);

describe("account authentication navigation", () => {
  it("keeps the current page after login, registration, or password reset", () => {
    expect(source).not.toContain("router.push('/studio?tool=image')");
  });

  it("still runs an action that was waiting for authentication", () => {
    expect(source.match(/if \(pendingCallback\)/g)).toHaveLength(3);
    expect(source.match(/pendingCallback\(\)/g)).toHaveLength(3);
  });
});
