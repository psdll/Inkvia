import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { safeAdminLimit } from "@/lib/admin-operational";

const root = process.cwd();

function read(relativePath: string) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

describe("admin operational architecture contract", () => {
  it("declares the long-term admin read models in Prisma schema", () => {
    const schema = read("prisma/schema.prisma");
    [
      "model AdminEvent",
      "model AdminUserSummary",
      "model AdminWorkFeed",
      "model AdminMediaCatalog",
      "model AdminDailyStats",
      "model AdminModelUsageDaily",
      "model AdminStorageSnapshot",
      "model AdminJob",
      "model AdminAuditLog",
    ].forEach((needle) => expect(schema).toContain(needle));
  });

  it("ships a migration for all admin operational tables", () => {
    const migration = read("prisma/migrations/20260708090000_admin_operational_read_models/migration.sql");
    [
      'CREATE TABLE "AdminEvent"',
      'CREATE TABLE "AdminUserSummary"',
      'CREATE TABLE "AdminWorkFeed"',
      'CREATE TABLE "AdminMediaCatalog"',
      'CREATE TABLE "AdminDailyStats"',
      'CREATE TABLE "AdminModelUsageDaily"',
      'CREATE TABLE "AdminStorageSnapshot"',
      'CREATE TABLE "AdminJob"',
      'CREATE TABLE "AdminAuditLog"',
      'CREATE INDEX "AdminWorkFeed_authUserId_createdAt_generationId_idx"',
      'CREATE INDEX "AdminMediaCatalog_authUserId_sourceType_createdAt_mediaId_idx"',
    ].forEach((needle) => expect(migration).toContain(needle));
  });

  it("does not expose separate admin v2 route entrypoints", () => {
    [
      "app/api/admin/v2/users/route.ts",
      "app/api/admin/v2/users/[adminKey]/overview/route.ts",
      "app/api/admin/v2/users/[adminKey]/works/route.ts",
      "app/api/admin/v2/users/[adminKey]/media/route.ts",
      "app/api/admin/v2/analytics/daily/route.ts",
      "app/api/admin/v2/analytics/models/route.ts",
      "app/api/admin/v2/storage/snapshots/route.ts",
      "app/api/admin/v2/jobs/route.ts",
      "app/api/admin/v2/jobs/[jobId]/route.ts",
      "app/api/admin/v2/audit/route.ts",
    ].forEach((relativePath) => {
      expect(fs.existsSync(path.join(root, relativePath))).toBe(false);
    });
  });

  it("keeps admin list page sizes bounded", () => {
    expect(safeAdminLimit("")).toBe(60);
    expect(safeAdminLimit("0")).toBe(1);
    expect(safeAdminLimit("9999")).toBe(200);
    expect(safeAdminLimit("abc", 80)).toBe(80);
  });

  it("keeps admin jobs aligned with local storage instead of OSS migration", () => {
    const service = read("lib/admin-operational.ts");
    expect(service).toContain('"reindex_local_uploads"');
    expect(service).not.toContain("migrate_uploads_to_object_storage");
  });

  it("keeps the legacy admin UI as the only admin page shell", () => {
    const adminPage = read("app/admin/page.tsx");
    expect(adminPage).not.toContain("AdminOperationalConsole");
    expect(adminPage).not.toContain("/api/admin/v2/users");
    [
      "app/admin/overview/page.tsx",
      "app/admin/users/page.tsx",
      "app/admin/assets/page.tsx",
      "app/admin/products/page.tsx",
      "app/admin/models/page.tsx",
      "app/admin/storage/page.tsx",
      "app/admin/jobs/page.tsx",
      "app/admin/audit/page.tsx",
      "app/admin/settings/page.tsx",
      "components/admin/AdminOperationalConsole.tsx",
    ].forEach((relativePath) => {
      expect(fs.existsSync(path.join(root, relativePath))).toBe(false);
    });
  });

  it("keeps the legacy works tab from requesting an unbounded list", () => {
    const adminPage = read("app/admin/page.tsx");
    expect(adminPage).not.toContain('url.searchParams.set("all", "1")');
    expect(adminPage).not.toContain("pageSize: 0");
  });
});
