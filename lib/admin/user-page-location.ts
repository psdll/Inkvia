import type { UserDetailTab } from "@/components/admin/UserDetailTabBar";

const USER_TABS = new Set<UserDetailTab>(["analysis", "works", "canvases", "materials", "presets", "skills", "billing"]);

export function getValidUserTab(params: { get: (key: string) => string | null } | null | undefined): UserDetailTab {
  const value = params?.get("userTab") as UserDetailTab;
  return USER_TABS.has(value) ? value : "analysis";
}

export function writeUserPageLocation(params: URLSearchParams, tab: UserDetailTab, user: string) {
  params.set("userTab", tab);
  if (user) params.set("user", user);
  else params.delete("user");
}
