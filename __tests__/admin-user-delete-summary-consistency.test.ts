import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("admin user delete summary consistency", () => {
  it("tombstones the user summary before reporting delete success", () => {
    const source = readFileSync(resolve(process.cwd(), "app/api/admin/user/delete/route.ts"), "utf8");
    const userDelete = source.indexOf("const canvasDeletion = await prisma.$transaction");
    const summaryDelete = source.indexOf("await tombstoneAdminUserSummary");
    const successResponse = source.indexOf("return NextResponse.json({", summaryDelete);

    expect(userDelete).toBeGreaterThan(-1);
    expect(summaryDelete).toBeGreaterThan(userDelete);
    expect(successResponse).toBeGreaterThan(summaryDelete);
    expect(source).toContain("linkedGuestUserIds: scopeInfo.linkedGuestUserIds");
    expect(source).toContain("occurredAt: summaryDeletedAt");
  });

  it("distinguishes a successful empty list from a failed user request", () => {
    const source = readFileSync(resolve(process.cwd(), "app/admin/page.tsx"), "utf8");
    const loadStart = source.indexOf("const loadUsers = React.useCallback");
    const loadEnd = source.indexOf("const loadUser = React.useCallback", loadStart);
    const loadUsers = source.slice(loadStart, loadEnd);

    expect(source).toContain("items: (json?.items || []) as AdminUserItem[]");
    expect(source).toContain("ok: Boolean(json)");
    expect(loadUsers).toContain("if (!ok) { setDirectoryError(true); return; }");
    expect(loadUsers).not.toContain("if (!items.length) return");
    expect(loadUsers).toContain("return items[0]?.adminKey || \"\"");
  });
});
