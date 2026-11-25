import { describe, expect, it } from "vitest";
import { hasSameRequestOrigin } from "@/lib/request-origin";
describe("credential mutation request origin", () => {
  it("accepts the browser destination when Next uses its internal bind hostname", () => {
    expect(hasSameRequestOrigin(new Request("http://localhost:3310/api/admin/auth-users", { headers: { host: "127.0.0.1:3310", origin: "http://127.0.0.1:3310" } }))).toBe(true);
    expect(hasSameRequestOrigin(new Request("http://internal:3000/api/admin/auth-users", { headers: { host: "app.example.test", "x-forwarded-proto": "https", origin: "https://app.example.test" } }))).toBe(true);
  });
  it("rejects missing, cross-site, mismatched-port and forged forwarded-host origins", () => {
    const cases: Array<Record<string, string>> = [{ host: "app.example.test" }, { host: "app.example.test", origin: "https://attacker.test", "x-forwarded-host": "attacker.test" }, { host: "127.0.0.1:3310", origin: "http://127.0.0.1:3100" }, { host: "app.example.test", origin: "https://app.example.test", "sec-fetch-site": "cross-site" }];
    for (const headers of cases) {
      expect(hasSameRequestOrigin(new Request("https://app.example.test/api", { headers }))).toBe(false);
    }
  });
});
