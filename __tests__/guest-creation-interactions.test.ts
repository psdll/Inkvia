import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(path, "utf8").replace(/\r\n/g, "\n");
}

describe("guest creation interactions", () => {
  it("keeps image and video inputs interactive while disabling generation", () => {
    const image = source("app/image/image-tool.tsx");
    const video = source("app/video/video-tool.tsx");

    expect(image).toContain(
      "const workspaceControlsDisabled = Boolean(userId) && (!workspaceDraftHydrated || !workspaceDraftWritable || !modelsConfirmed);",
    );
    expect(video).toContain(
      "const workspaceControlsDisabled = Boolean(userId) && (!workspaceDraftHydrated || !workspaceDraftWritable);",
    );
    expect(image).toContain('inert={workspaceControlsDisabled ? ("" as any) : undefined}');
    expect(video).toContain("inert={workspaceControlsDisabled}");
    for (const tool of [image, video]) {
      expect(tool).toContain("disabled={workspaceControlsDisabled}");
      expect(tool).toContain('if (!userId) return { disabled: true, label: "生成" };');
    }
  });

  it("disables face replacement generation for guests", () => {



  });

  it("disables generation in both image batch modes and live video mode", () => {
    const page = source("components/batch-workbench/batch-workbench-page.tsx");
    const settings = source("components/batch-workbench/batch-settings-panel.tsx");
    const live = source("components/batch-workbench/live-video-batch-workspace.tsx");

    expect(page).toContain("authenticated={Boolean(user)}");
    expect(settings).toContain("authenticated: boolean;");
    expect(settings).toContain("const generationBlocked = !authenticated");
    expect(settings).toContain("disabled={generationBlocked || generatePending || !batch.sharedPrompt.trim()}");
    expect(settings).toMatch(/disabled=\{\s+generationBlocked\s+\|\| segmentedPromptPending/);
    expect(live).toContain("const createDisabled = !accountId");
  });

  it("renders the normal empty assets workspace for guests", () => {
    const works = source("app/works/page.tsx");

    expect(works).not.toContain("登录后查看你的资产");
    expect(works).not.toContain("onClick={() => openLoginModal()}");
    expect(works).toContain("setItems([]);");
  });
});
