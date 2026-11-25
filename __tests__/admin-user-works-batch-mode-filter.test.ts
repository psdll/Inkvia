import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const service = readFileSync("lib/admin-user-works.ts", "utf8");
const mainRoute = readFileSync("app/api/admin/user/route.ts", "utf8");
const pageRoute = readFileSync("app/api/admin/user/works/route.ts", "utf8");
const changesRoute = readFileSync("app/api/admin/user/works/changes/route.ts", "utf8");
const page = readFileSync("app/admin/page.tsx", "utf8");

describe("administrator batch-mode asset filter", () => {
  it("uses Generation queries for batch and toolbox filters the read model cannot represent", () => {
    expect(service).toContain("canUseAdminWorksReadModel(sourceFilter)");
    expect(service).toContain('return source === "creation" || source === "canvas"');
  });

  it("validates batchMode in every administrator works route", () => {
    for (const source of [mainRoute, pageRoute, changesRoute]) {
      expect(source).toContain('searchParams.get("batchMode")');
      expect(source).toContain("isAssetBatchMode");
      expect(source).toContain('bad("invalid batchMode")');
    }
  });

  it("writes the same source parameters for initial, next-page, and changes requests", () => {
    expect(page.match(/applyAssetSourceFilterSearchParams\(/g) || []).toHaveLength(3);
  });
});
