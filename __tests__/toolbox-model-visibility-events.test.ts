import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

class FakeBroadcastChannel extends EventTarget {
  static instances: FakeBroadcastChannel[] = [];

  constructor(readonly name: string) {
    super();
    FakeBroadcastChannel.instances.push(this);
  }

  postMessage(data: unknown) {
    for (const channel of FakeBroadcastChannel.instances) {
      if (channel === this || channel.name !== this.name) continue;
      const event = new Event("message") as Event & { data?: unknown };
      event.data = data;
      channel.dispatchEvent(event);
    }
  }

  close() {}
}

function source(path: string) {
  return readFileSync(path, "utf8");
}

describe("toolbox model visibility events", () => {
  beforeEach(() => {
    vi.resetModules();
    FakeBroadcastChannel.instances = [];
    vi.stubGlobal("window", new EventTarget());
    vi.stubGlobal("BroadcastChannel", FakeBroadcastChannel);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("notifies the current page and other same-origin tabs after an admin save", async () => {
    const events = await import("@/lib/toolbox-model-visibility-events");
    const listener = vi.fn();
    const unsubscribe = events.subscribeToolboxModelVisibilityChanged(listener);

    events.publishToolboxModelVisibilityChanged();
    expect(listener).toHaveBeenCalledTimes(1);

    const otherTab = new FakeBroadcastChannel(events.TOOLBOX_MODEL_VISIBILITY_CHANNEL);
    otherTab.postMessage({ type: "changed" });
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    otherTab.postMessage({ type: "changed" });
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("connects only model-visibility consumers to the refresh signal", () => {
    expect(source("components/admin/ImageEditModelsPanel.tsx")).toContain(
      "publishToolboxModelVisibilityChanged()",
    );
    for (const path of [
      "app/image/image-tool.tsx",
      "app/video/video-tool.tsx",
      "components/batch-workbench/batch-workbench-page.tsx",
      "hooks/use-live-video-batch-workspace.ts",
      "components/canvas/use-canvas-models.ts",
    ]) {
      expect(source(path)).toContain("subscribeToolboxModelVisibilityChanged");
    }
  });

  it("revalidates a returning page even when it missed the save broadcast", async () => {
    const doc = Object.assign(new EventTarget(), { visibilityState: "hidden" });
    vi.stubGlobal("document", doc);
    const events = await import("@/lib/toolbox-model-visibility-events");
    const listener = vi.fn();
    const unsubscribe = events.subscribeToolboxModelVisibilityChanged(listener);
    doc.dispatchEvent(new Event("visibilitychange"));
    expect(listener).not.toHaveBeenCalled();
    doc.visibilityState = "visible";
    doc.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new Event("pageshow"));
    expect(listener).toHaveBeenCalledTimes(3);
    unsubscribe();
    doc.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("focus"));
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it("uses storage notifications when BroadcastChannel is unavailable", async () => {
    vi.stubGlobal("BroadcastChannel", undefined);
    const setItem = vi.fn();
    Object.assign(window, { localStorage: { setItem } });
    const events = await import("@/lib/toolbox-model-visibility-events");
    const listener = vi.fn();
    const unsubscribe = events.subscribeToolboxModelVisibilityChanged(listener);
    events.publishToolboxModelVisibilityChanged();
    expect(setItem).toHaveBeenCalledWith(events.TOOLBOX_MODEL_VISIBILITY_STORAGE_KEY, expect.any(String));
    expect(listener).toHaveBeenCalledTimes(1);
    window.dispatchEvent(Object.assign(new Event("storage"), { key: events.TOOLBOX_MODEL_VISIBILITY_STORAGE_KEY, newValue: "saved-revision" }));
    expect(listener).toHaveBeenCalledTimes(2);
    window.dispatchEvent(Object.assign(new Event("storage"), { key: "unrelated", newValue: "ignored" }));
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it("uses the same save signal to refresh effective video resolutions", () => {
    const admin = source("components/admin/ImageEditModelsPanel.tsx");
    const video = source("app/video/video-tool.tsx");
    const liveBatch = source("hooks/use-live-video-batch-workspace.ts");
    const liveModelsRoute = source("app/api/live-video-batches/models/route.ts");
    const canvasModels = source("components/canvas/use-canvas-models.ts");

    expect(admin).toContain("JSON.stringify({ visibility, resolutionVisibility, displayNames, durationVisibility })");
    expect(admin.indexOf("publishToolboxModelVisibilityChanged()"))
      .toBeGreaterThan(admin.indexOf("setSavedResolutionVisibility"));
    expect(video).toContain("getVideoDisplaySpec(id, json.models)");
    expect(video).toContain("!modelSpec.supportedResolutions.includes(resolution as any)");
    expect(liveBatch).toContain('"/api/live-video-batches/models"');
    expect(liveModelsRoute).toContain("visibleModel.supportedResolutions || []");
    expect(canvasModels).toContain('fetch("/api/canvas/models", { cache: "no-store" })');
  });
});
