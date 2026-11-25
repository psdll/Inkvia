import { expect, it } from "vitest";
import { getValidUserTab, writeUserPageLocation } from "@/lib/admin/user-page-location";
import type { UserDetailTab } from "@/components/admin/UserDetailTabBar";

it.each(["analysis", "works", "canvases", "materials", "presets", "skills", "billing"] satisfies UserDetailTab[])("restores %s and the selected user from a reloaded URL", (tab) => {
  const params = new URLSearchParams("tab=users");
  writeUserPageLocation(params, tab, "user:测试 & 2");
  const reloaded = new URLSearchParams(params.toString());
  expect(getValidUserTab(reloaded)).toBe(tab);
  expect(reloaded.get("user")).toBe("user:测试 & 2");
  expect(reloaded.get("tab")).toBe("users");
});
it("falls back safely for missing or obsolete subtabs", () => {
  expect(getValidUserTab(new URLSearchParams())).toBe("analysis");
  expect(getValidUserTab(new URLSearchParams("userTab=unknown"))).toBe("analysis");
  expect(getValidUserTab(new URLSearchParams("userTab=agent"))).toBe("analysis");
});
it("clears a removed user without losing the current subpage or unrelated parameters", () => {
  const params = new URLSearchParams("tab=users&user=deleted&extra=value");
  writeUserPageLocation(params, "works", "");
  expect(params.has("user")).toBe(false);
  expect(getValidUserTab(params)).toBe("works");
  expect(params.get("extra")).toBe("value");
});
