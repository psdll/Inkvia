import { describe, expect, test } from "vitest";
import { shouldHandleUserSessionUnauthorized } from "@/lib/auth-session-response";

const APP_ORIGIN = "https://studio.example.test";

describe("shouldHandleUserSessionUnauthorized", () => {
  test("identifies an unauthenticated first-party business API response", () => {
    expect(
      shouldHandleUserSessionUnauthorized({
        url: "/api/canvas/projects",
        status: 401,
        origin: APP_ORIGIN,
      }),
    ).toBe(true);
  });

  test("does not treat login, admin, external, or non-401 responses as a user session failure", () => {
    const excluded = [
      { url: "/api/auth/login", status: 401 },
      { url: "/api/admin/providers", status: 401 },
      { url: "https://provider.example.test/v1/models", status: 401 },
      { url: "/api/canvas/projects", status: 403 },
    ];

    for (const input of excluded) {
      expect(shouldHandleUserSessionUnauthorized({ ...input, origin: APP_ORIGIN })).toBe(false);
    }
  });
});
