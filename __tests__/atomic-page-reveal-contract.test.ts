import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { PAGE_REVEAL_STRATEGIES } from "@/lib/page-reveal/route-strategies";

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("atomic page reveal contract", () => {
  it("announces route loading with a themed accessible fallback", () => {
    const fallback = read("app/loading.tsx");
    expect(fallback).toContain('aria-busy="true"');
    expect(fallback).toContain('role="status"');
    expect(fallback).toContain('var(--app-bg)');
  });

  it("keeps pending content visible and latches real business readiness", () => {
    const source = read("components/layout/atomic-page-reveal.tsx");

    expect(source).not.toContain("waitForPageMedia");
    expect(source).toContain("hasRevealedRef");
    expect(source).toContain("if (!ready || hasRevealedRef.current) return;");
    expect(source).toContain("app:page-reveal-ready");
    expect(source).toContain("data-page-reveal-state");
    expect(source).not.toContain("atomic-page-reveal__cover");
    expect(source).not.toContain("window.setTimeout(() => reveal(true)");
  });

  it("keeps eligible internal navigation free of a top progress indicator", () => {
    const source = read("components/layout/page-transition.tsx");

    expect(source).not.toContain("onClickCapture");
    expect(source).not.toContain("app:navigation-start");
    expect(source).not.toContain('window.addEventListener("app:page-reveal-ready"');
    expect(source).not.toContain("route-progress-indicator");
    expect(source).not.toContain("event.defaultPrevented");
    expect(source).not.toContain('anchor.target === "_blank"');
  });

  it("uses shared theme variables and respects reduced motion", () => {
    const css = read("app/globals.css");

    expect(css).toContain(".atomic-page-reveal");
    expect(css).not.toContain(".route-progress-indicator");
    expect(css).not.toContain("route-progress-slide");
    expect(css).toContain("var(--primary-bg)");
    expect(css).toContain("var(--app-bg)");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    const pendingRule = css.match(
      /\.atomic-page-reveal\[data-page-reveal-state="pending"\][\s\S]*?\}/,
    )?.[0] ?? "";
    expect(pendingRule).not.toContain("opacity: 0");
    expect(pendingRule).not.toContain("pointer-events: none");
    expect(css).not.toContain(".atomic-page-reveal__cover");
  });

  it("registers an explicit reveal strategy for every app page", () => {
    const pageFiles = readdirSync(resolve(root, "app"), { recursive: true })
      .map(String)
      .filter((path) => path.replaceAll("\\", "/").endsWith("page.tsx"))
      .sort();
    const registry = read("lib/page-reveal/route-strategies.ts");

    expect(Object.keys(PAGE_REVEAL_STRATEGIES).sort()).toEqual(
      pageFiles.map((path) => `app/${path.replaceAll("\\", "/")}`).sort(),
    );
    for (const pageFile of pageFiles) {
      const routeFile = `app/${pageFile.replaceAll("\\", "/")}`;
      expect(registry, routeFile).toContain(`"${routeFile}"`);
    }
  });

  it("wires async pages to their existing first-load state", () => {
    const materials = read("app/materials/page.tsx");
    const inspirations = read("app/material-inspirations/page.tsx");
    const works = read("app/works/page.tsx");
    const canvas = read("app/canvas/page.tsx");
    const canvasEditor = read("components/canvas/CanvasEditorPage.tsx");
    const batch = read("components/batch-workbench/batch-workbench-page.tsx");
    const adminHome = read("app/admin/page.tsx");
    const adminMaterials = read("app/admin/materials/page.tsx");
    const adminMaterialAssets = read("app/admin/material-assets/page.tsx");
    const adminRoleSkillEditor = read("components/admin/SystemRoleSkillEditorPage.tsx");

    expect(materials).toContain("<AtomicPageReveal ready={statusReady && !authLoading && hasLoadedOnce}>");
    expect(inspirations).toContain("<AtomicPageReveal ready={!authLoading && (!user || hasLoadedOnce)}>");
    expect(works).toContain("<AtomicPageReveal ready={!authLoading && hasSettledInitialLoad}>");
    expect(canvas).toContain("<AtomicPageReveal ready={!authLoading && hasSettledInitialLoad}>");
    expect(canvasEditor).toContain("<AtomicPageReveal ready={!authLoading && hasSettledInitialLoad}>");
    expect(batch).toContain("<AtomicPageReveal ready={!authLoading && !loading} onReveal={onInitialReady}>");
    expect(adminHome).toContain("<AtomicPageReveal>");
    expect(adminHome).toContain("setDirectoryLoading(true)");
    expect(adminHome).toContain("<AdminTopHeader");
    expect(adminMaterials).toContain("<AtomicPageReveal ready={hasLoadedOnce}>");
    expect(adminMaterialAssets).toContain("<AtomicPageReveal ready={hasLoadedOnce}>");
    expect(adminRoleSkillEditor).toContain("<AtomicPageReveal ready={!loading && catalogSettled}>");
  });

  it("keeps the standalone system Skill editor filling the reveal frame", () => {
    const source = read("components/admin/SystemRoleSkillEditorPage.tsx");
    const mainClasses = source.match(/<main className="([^"]+)"/)?.[1]?.split(/\s+/) ?? [];

    expect(mainClasses).toContain("min-w-0");
    expect(mainClasses).toContain("flex-1");
  });

  it("keeps the Studio frame stable while the selected tool resolves", () => {
    const studio = read("app/studio/page.tsx");

    expect(studio).not.toContain("!resolvedTool ? (");
    expect(studio).toContain("readyTools.has(resolvedTool)");
    expect(studio).toContain("historyReady");
    expect(studio).toContain("<StudioToolTabs");
    expect(studio).toContain("{!activeToolReady ? <StudioToolBodyLoading /> : null}");
    expect(studio).not.toContain("displayedTool");
    expect(studio).toContain("onInitialReady={markHistoryReady}");
    expect(studio).toContain('onInitialReady={() => markToolReady("image")}');
    expect(studio).toContain('onInitialReady={() => markToolReady("video")}');
    expect(studio).not.toContain('markToolReady("face")');
  });

  it("keeps reveal wiring presentation-only", () => {
    const revealFiles = [
      "components/layout/atomic-page-reveal.tsx",
      "components/layout/page-transition.tsx",
      "lib/page-reveal/media-readiness.ts",
      "lib/page-reveal/route-strategies.ts",
    ];

    for (const file of revealFiles) {
      const source = read(file);
      expect(source, file).not.toContain("fetch(");
      expect(source, file).not.toContain("localStorage");
      expect(source, file).not.toContain("sessionStorage");
      expect(source, file).not.toContain("caches.");
      expect(source, file).not.toContain("serviceWorker");
    }
  });
});
