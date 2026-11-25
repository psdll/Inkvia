import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  isImageWorkspaceDisplayReady,
  readImageWorkspaceDisplayCache,
  updateImageWorkspaceDisplayCache,
} from "@/lib/tool-workspace-draft/image-display-cache";
import type { ToolWorkspaceDraftDto } from "@/lib/tool-workspace-draft/client";

function createStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
}

const draft: ToolWorkspaceDraftDto = {
  id: "draft-27",
  tool: "image",
  schemaVersion: 1,
  payload: {
    schemaVersion: 1,
    tool: "image",
    state: { prompt: "ergonomic chair", model: "gpt-image-2" },
  },
  version: 8,
  updatedAt: "2026-08-14T12:00:00.000Z",
  media: [{
    relationId: "relation-1",
    mediaId: "4d4c89bd-a810-4f24-a734-245578698d0b",
    position: 0,
    slot: null,
    kind: "image",
    status: "ready",
    originalName: "chair.png",
    mimeType: "image/png",
    sizeBytes: 1024,
    localPreviewUrl: "/api/assets/preview/4d4c89bd-a810-4f24-a734-245578698d0b",
    createdAt: "2026-08-14T11:59:00.000Z",
  }],
};

describe("image workspace display cache", () => {
  it("keeps cached image models hidden until the server confirmation settles", () => {
    const source = readFileSync(resolve(process.cwd(), "app/image/image-tool.tsx"), "utf8");

    expect(source).toContain("readImageWorkspaceDisplayCache");
    expect(source).toContain("updateImageWorkspaceDisplayCache");
    expect(source).toContain("isImageWorkspaceDisplayReady({");
    expect(source).toContain("setWorkspaceDisplayCacheRestored(true)");
    expect(source).toMatch(/workspaceControlsDisabled[\s\S]{0,160}!modelsConfirmed/);
    expect(source).not.toContain('"正在确认模型…"');
    expect(source).toMatch(/if \(!initial\) return;\s*setVisibleModelOptions\(\[\]\);\s*setModelsConfirmed\(false\);/);
  });

  it("fetches image models on mount and when visibility changes", () => {
    const source = readFileSync(resolve(process.cwd(), "app/image/image-tool.tsx"), "utf8");
    const fetchIndex = source.indexOf('loadImageModelCatalog({ refresh: !initial }');
    const effectStart = source.lastIndexOf("React.useEffect(() => {", fetchIndex);
    const effectEnd = source.indexOf("\n  React.useEffect(() => {", fetchIndex);
    const modelCatalogEffect = source.slice(effectStart, effectEnd);

    expect(fetchIndex).toBeGreaterThan(-1);
    expect(modelCatalogEffect).not.toContain("if (!isActive) return;");
    expect(modelCatalogEffect).toContain("subscribeToolboxModelVisibilityChanged");
    expect(modelCatalogEffect).toMatch(/\}, \[\]\);\s*$/);
  });

  it("does not reveal cached content before model and server draft refreshes finish", () => {
    expect(isImageWorkspaceDisplayReady({
      authLoading: false,
      userId: "27",
      displayCacheRestored: true,
      modelsSettled: false,
      workspaceDraftHydrated: false,
    })).toBe(false);
  });

  it("keeps a cold workspace on its skeleton until the network state is ready", () => {
    expect(isImageWorkspaceDisplayReady({
      authLoading: false,
      userId: "27",
      displayCacheRestored: false,
      modelsSettled: true,
      workspaceDraftHydrated: false,
    })).toBe(false);
    expect(isImageWorkspaceDisplayReady({
      authLoading: false,
      userId: "27",
      displayCacheRestored: false,
      modelsSettled: true,
      workspaceDraftHydrated: true,
    })).toBe(true);
  });

  it("restores the full display draft and confirmed model list for the same user", () => {
    const storage = createStorage();
    const key = "tool_workspace_display_cache_v1:image:27";

    updateImageWorkspaceDisplayCache(storage, key, {
      userId: "27",
      draft,
      visibleModelIds: ["gpt-image-2", "nano-banana-pro"],
    });

    expect(readImageWorkspaceDisplayCache(storage, key, "27")).toMatchObject({
      userId: "27",
      draft,
      visibleModelIds: ["gpt-image-2", "nano-banana-pro"],
    });
  });

  it("never restores a cache created for another user", () => {
    const storage = createStorage();
    const key = "tool_workspace_display_cache_v1:image:27";
    updateImageWorkspaceDisplayCache(storage, key, { userId: "27", draft });

    expect(readImageWorkspaceDisplayCache(storage, key, "28")).toBeNull();
  });

  it("merges background model refreshes without discarding the cached draft", () => {
    const storage = createStorage();
    const key = "tool_workspace_display_cache_v1:image:27";
    updateImageWorkspaceDisplayCache(storage, key, { userId: "27", draft });

    updateImageWorkspaceDisplayCache(storage, key, {
      userId: "27",
      visibleModelIds: ["nano-banana-pro"],
    });

    expect(readImageWorkspaceDisplayCache(storage, key, "27")).toMatchObject({
      draft,
      visibleModelIds: ["nano-banana-pro"],
    });
  });
});
