import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const page = readFileSync(
  resolve(root, "components/batch-workbench/batch-workbench-page.tsx"),
  "utf8",
);
const liveWorkspaceHook = readFileSync(
  resolve(root, "hooks/use-live-video-batch-workspace.ts"),
  "utf8",
);

describe("batch workbench mode keepalive", () => {
  it("keeps both polling owners mounted after every mode switch", () => {
    expect(page).not.toContain("const imageMounted =");
    expect(page).not.toContain("const liveMounted =");
    expect(page).not.toContain("{imageMounted ? (");
    expect(page).not.toContain("{liveMounted ? (");
    expect(page.match(/data-workbench-surface-mounted="true"/g) || []).toHaveLength(2);
    expect(page).toContain("<ImageBatchWorkbenchPage");
    expect(page).toContain("<LiveVideoBatchWorkspace");
    expect(page).toContain("<BatchResultRegistryProvider>");
    expect(page).toContain("<UnifiedBatchResults");
    expect(page).toContain('data-batch-mode-host="true"');
  });

  it("continues both independent polling loops while only one surface is visible", () => {
    expect(page).toContain("window.setInterval(async () => {");
    expect(page).toContain("void refreshActiveHistoryStatuses(activeHistoryBatchIdsKey.split(\",\"));");
    expect(liveWorkspaceHook).toContain("const timer = window.setInterval(() => {");
    expect(page.match(/aria-hidden=\{displayedSurface !==/g) || []).toHaveLength(2);
    expect(page).toContain("function inertWhenHidden(hidden: boolean)");
    expect(page.match(/\{\.\.\.inertWhenHidden\(displayedSurface !==/g) || []).toHaveLength(2);
    expect(page).toContain('displayedSurface === "image" ? "visible" : "invisible"');
    expect(page).toContain('displayedSurface === "live" ? "visible" : "invisible"');
  });

  it("remembers readiness when the hidden surface finishes loading before it is requested", () => {
    expect(page).toContain("const [readySurfaces, setReadySurfaces]");
    expect(page).toContain("if (!readySurfaces.has(requestedSurface)) return;");
    expect(page).toContain("setDisplayedSurface(requestedSurface);");
    expect(page).toContain('markSurfaceReady("image")');
    expect(page).toContain('markSurfaceReady("live")');
  });

  it("switches image and video surfaces without a second visual transition", () => {
    const shell = page.slice(page.indexOf("export function BatchWorkbenchPage()"));

    expect(shell).not.toContain("transition-opacity duration-150");
  });

  it("keeps one shared right result surface outside mode visibility switching", () => {
    const shell = page.slice(page.indexOf("export function BatchWorkbenchPage()"));

    expect(shell.match(/<UnifiedBatchResults\b/g) || []).toHaveLength(1);
    expect(shell).toContain('data-batch-unified-result-shell="true"');
    expect(shell.indexOf("<UnifiedBatchResults")).toBeGreaterThan(
      shell.lastIndexOf('data-workbench-surface-mounted="true"'),
    );
  });
});
