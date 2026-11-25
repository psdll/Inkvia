import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { visitStudioTool, type StudioTool } from "@/lib/studio/visited-tools";

const root = process.cwd();

describe("studio tool keepalive", () => {
  it("adds a tool once and preserves Set identity on revisits", () => {
    const imageOnly = new Set<StudioTool>(["image"]);
    const withVideo = visitStudioTool(imageOnly, "video");

    expect([...withVideo]).toEqual(["image", "video"]);
    expect(visitStudioTool(withVideo, "video")).toBe(withVideo);
    expect(imageOnly.has("video")).toBe(false);
  });

  it("loads each tool dynamically and keeps visited tools mounted", () => {
    const source = readFileSync(resolve(root, "app/studio/page.tsx"), "utf8");

    expect(source).not.toMatch(/import ImagePage from ["']@\/app\/image\/image-tool["']/);
    expect(source).not.toMatch(/import VideoPage from ["']@\/app\/video\/video-tool["']/);
    expect(source).toContain('const loadImagePage = () => import("@/app/image/image-tool")');
    expect(source).toContain("dynamic(loadImagePage");
    expect(source).toContain('const loadVideoPage = () => import("@/app/video/video-tool")');
    expect(source).toContain("dynamic(loadVideoPage");
    expect(source).toContain('new Set<StudioTool>([initialTool])');
    expect(source).toContain('visitedTools.has("image")');
    expect(source).toContain('visitedTools.has("video")');
    expect(source).toContain('activeTool === "image" ? (activeToolReady ? "visible flex" : "invisible flex") : "hidden"');
    expect(source).toContain('activeTool === "video" ? (activeToolReady ? "visible flex" : "invisible flex") : "hidden"');
  });

  it("does not eagerly load both modes before a user selects them", () => {
    const source = readFileSync(resolve(root, "app/studio/page.tsx"), "utf8");

    expect(source).toContain('const loadVideoPage = () => import("@/app/video/video-tool")');
    expect(source).not.toContain("void loadImagePage()");
    expect(source).not.toContain("void loadVideoPage()");
  });

  it("mounts the selected cold tool behind a local skeleton while the shared shell stays visible", () => {
    const source = readFileSync(resolve(root, "app/studio/page.tsx"), "utf8");

    expect(source).toContain("<StudioToolTabs");
    expect(source).toContain('const activeTool = resolvedTool || "image"');
    expect(source).toContain("const activeToolReady = Boolean(resolvedTool && readyTools.has(resolvedTool))");
    expect(source).toContain('data-studio-tool-body-state={activeToolReady ? "ready" : "loading"}');
    expect(source).toContain("{!activeToolReady ? <StudioToolBodyLoading /> : null}");
    expect(source).toContain('activeTool === "image" ? (activeToolReady ? "visible flex" : "invisible flex") : "hidden"');
    expect(source).toContain('activeTool === "video" ? (activeToolReady ? "visible flex" : "invisible flex") : "hidden"');
    expect(source).toContain("embeddedInStudioShell");
    expect(source).not.toContain("displayedTool");
    expect(source).not.toContain("pendingTool");
  });

  it("lets the Studio parent own the only panel and mode bar", () => {
    const toolSources = [
      "app/image/image-tool.tsx",
      "app/video/video-tool.tsx",
    ].map((path) => readFileSync(resolve(root, path), "utf8"));

    for (const source of toolSources) {
      expect(source).toContain("embeddedInStudioShell");
      expect(source).toContain("embeddedInStudioShell?: boolean");
      expect(source).toContain('embeddedInStudioShell ? "contents"');
      expect(source).toContain("{!embeddedInStudioShell ? (");
    }
  });
});
