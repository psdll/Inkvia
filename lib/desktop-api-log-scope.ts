import type { Prisma } from "@prisma/client";
import { isDesktopMode } from "@/lib/desktop-mode";

export function isDesktopApiLogView(params: URLSearchParams) {
  return isDesktopMode() && params.get("view") === "desktop-api";
}

export function desktopApiLogScope(userId: number): Prisma.LogWhereInput {
  return {
    OR: [
      { userId: String(userId), category: { in: ["api", "generation"] } },
      // The LLM gateway records API calls under system when it has no workspace identity.
      { userId: "system", category: "api" },
    ],
    action: { not: "admin_login" },
  };
}
