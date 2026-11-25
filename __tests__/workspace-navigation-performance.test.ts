import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("workspace sidebar navigation performance", () => {
  it("hides the workspace sidebar on canvas routes and on web admin routes", () => {
    const appShell = read("components/layout/app-shell.tsx");

    expect(appShell).toContain('import { usePathname } from "next/navigation"');
    expect(appShell).toContain(
      'const isCanvasRoute = pathname === "/canvas" || pathname?.startsWith("/canvas/");',
    );
    expect(appShell).toContain(
      'const isAdminRoute = pathname === "/admin" || pathname?.startsWith("/admin/");',
    );
    expect(appShell).toContain(
      "const shouldShowSidebar = !isCanvasRoute && (!isAdminRoute || desktopMode);",
    );
    expect(appShell).toContain("before={shouldShowSidebar && <WorkspaceSidebar />}");
    expect(appShell).not.toContain("<WorkspaceSidebar />\n        <PageTransition>");
  });

  it("warms only the sidebar destination signaled by user intent", () => {
    const appShell = read("components/layout/app-shell.tsx");
    const sidebar = read("components/layout/workspace-sidebar.tsx");

    expect(appShell).not.toContain("RoutePrefetcher");
    expect(appShell).not.toContain("router.prefetch");
    expect(sidebar).toContain("router.prefetch(href)");
    expect(sidebar).toContain("onPointerEnter={() => warmWorkspaceDestination(item.href)}");
    expect(sidebar).toContain("onFocus={() => warmWorkspaceDestination(item.href)}");
    expect(sidebar).not.toContain("mainNavItems.forEach");
    expect(sidebar).not.toContain("requestIdleCallback");
    expect(sidebar).toContain("const WORKSPACE_LINK_PREFETCH = false;");
    expect(sidebar).toContain("prefetch={WORKSPACE_LINK_PREFETCH}");
  });

  it("does not compete with navigation by eagerly warming media", () => {
    const cacheKeeper = read("components/media-library/product-cache-keeper.tsx");

    expect(cacheKeeper).toContain('fetchPriority="low"');
    expect(cacheKeeper).toContain("scheduleIdleBatches");
    expect(cacheKeeper).toContain("urls.slice(0, warmedCount)");
    expect(cacheKeeper).toContain("pageSize=96");
    expect(cacheKeeper).toContain("primaryThumbUrl");
  });

  it("uses the normal Next route switch without mounting a hidden second page", () => {
    const loadingPath = resolve(root, "app/loading.tsx");

    expect(existsSync(loadingPath)).toBe(true);
    expect(read("app/loading.tsx")).toContain('role="status"');
    expect(read("app/loading.tsx")).toContain("var(--app-bg)");
    const transition = read("components/layout/page-transition.tsx");
    expect(transition).not.toContain("route-progress-indicator");
    expect(transition).not.toContain("LayoutRouterContext");
    expect(transition).not.toContain("routePending");
    expect(transition).not.toContain("data-route-transition-slot");
    expect(transition).not.toContain("event.preventDefault()");
    expect(transition).not.toContain("router.push(");
  });

  it("does not intercept links or wait for business and media readiness", () => {
    const transition = read("components/layout/page-transition.tsx");

    expect(transition).not.toContain("onClickCapture");
    expect(transition).not.toContain("app:navigation-start");
    expect(transition).not.toContain('window.addEventListener("app:page-reveal-ready"');
  });

  it("does not extend route switches with a whole-page view transition", () => {
    const transition = read("components/layout/page-transition.tsx");

    expect(transition).not.toContain("startViewTransition");
    expect(transition).not.toContain("ViewTransitionDocument");
    expect(transition).not.toContain("commit();");
  });

  it("warms only the Design destination when the user signals intent", () => {
    const home = read("components/home/home-page-client.tsx");

    expect(home).toContain('router.prefetch("/studio?tool=image")');
    expect(home).toContain('import("@/app/image/image-tool")');
    expect(home).toContain("onPointerEnter={tag.label === \"Design\" ? warmDesignDestination : undefined}");
    expect(home).toContain("onFocus={tag.label === \"Design\" ? warmDesignDestination : undefined}");
    expect(home).not.toContain("requestIdleCallback");
  });

  it("does not block home navigation on the inspiration database query", () => {
    const homePage = read("app/(home)/page.tsx");

    expect(homePage).not.toContain("getHomeInspirationTemplates");
    expect(homePage).not.toContain("export default async function HomePage");
    expect(homePage).toContain("<HomePageClient />");
  });

  it("marks the clicked destination active before the pathname commits", () => {
    const sidebar = read("components/layout/workspace-sidebar.tsx");

    expect(sidebar).toContain("pendingHref");
    expect(sidebar).toContain("setPendingHref(item.href)");
    expect(sidebar).toContain('setPendingHref(desktopMode ? "/admin" : "/settings")');
    expect(sidebar).toContain('aria-current={active ? "page" : undefined}');
  });

  it("reuses the warmed materials entry on navigation and retains explicit refresh support", () => {
    const materialsPage = read("app/materials/page.tsx");
    const sidebar = read("components/layout/workspace-sidebar.tsx");
    const materialsEntry = read("lib/client/materials-entry.ts");

    expect(sidebar).toContain("warmWorkspaceDestination(item.href)");
    expect(materialsEntry).toContain("Date.now() - entry.at < 30000");
    expect(materialsPage).toContain("MATERIALS_SIDEBAR_REFRESH_KEY");
    expect(materialsPage).toContain('window.addEventListener("materials:refresh", handleSidebarRefresh)');
    expect(materialsPage).not.toContain("refreshOnEntryRef");
    expect(materialsPage).toContain('fetchItems(1, "replace", { bypassCache: true })');
  });

  it("coalesces Strict Mode GET requests on materials and settings pages", () => {
    const materialsPage = read("app/materials/page.tsx");
    const settingsPage = read("app/settings/page.tsx");
    const settingsQueries = read("lib/client/settings-queries.ts");

    expect(materialsPage).not.toContain('fetchJsonOnce("/api/material-request-doc")');
    expect(materialsPage).not.toContain("欢迎有需要的同事进行下载使用素材");
    expect(materialsPage).not.toContain("打开素材需求文档");
    expect(materialsPage).toContain('fetchJsonOnce("/api/material-assets/categories")');
    expect(materialsPage).toContain("takeMaterialsEntry : fetchJsonOnce)(`/api/material-assets?${params.toString()}`, requestScope)");
    expect(settingsPage).not.toContain("useQuery");
    expect(read("components/settings/material-tools.tsx")).toContain('useQuery(settingsEntryOptions(user?.id))');
    expect(settingsQueries).toContain('fetchJsonOnce<SettingsEntry>("/api/settings/entry", scope)');
    expect(settingsQueries).toContain('fetchJsonOnce<{ stats?: ProfileStats }>("/api/auth/me/stats", scope)');
  });

  it("opens the infinite canvas entry in a new tab without changing the current page state", () => {
    const sidebar = read("components/layout/workspace-sidebar.tsx");

    expect(sidebar).toContain('const opensInNewTab = item.href === "/canvas";');
    expect(sidebar).toContain('target={opensInNewTab ? "_blank" : undefined}');
    expect(sidebar).toContain('rel={opensInNewTab ? "noopener noreferrer" : undefined}');
    expect(sidebar).toContain("if (!opensInNewTab &&");
  });
});
