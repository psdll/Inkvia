import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";

it("removes age-based archive controls from administrator settings", () => {
  const source = readFileSync(resolve(process.cwd(), "components/admin/AdminOverviewTab.tsx"), "utf8");
  expect(source).not.toContain("MaterialArchiveSetting");
  expect(existsSync(resolve(process.cwd(), "components/admin/MaterialArchiveSetting.tsx"))).toBe(false);
  const route = readFileSync(resolve(process.cwd(), "app/api/admin/user/route.ts"), "utf8");
  expect(route).not.toContain("materialArchiveCutoff");
});
