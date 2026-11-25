// @vitest-environment ./__tests__/jsdom-no-canvas-environment.ts
import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import postcss from "postcss";
import tailwindcss from "tailwindcss";

vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => ({ user: null }) }));
vi.mock("@/components/ui/confirm-dialog", () => ({ ConfirmDialog: () => null }));
vi.mock("@/components/ui/media-lightbox", () => ({ MediaLightbox: () => null }));
vi.mock("@/components/ui/media-image", () => ({
  MediaImage: ({ src, className }: { src: string; className?: string }) => React.createElement("img", { src, className }),
}));

// Use both real components and compiled utilities: the regression depends on
// Tailwind's .relative rule overriding .absolute on the same poster element.
import { UnifiedHistoryPanel } from "@/components/history/unified-history-panel";

let css: string;
let host: HTMLDivElement;
let root: Root;
let stylesheet: HTMLStyleElement;
let sequence = 0;

beforeAll(async () => {
  const compiled = await postcss([tailwindcss({
    content: [
      "./components/history/unified-history-panel.tsx",
      "./components/ui/video-poster-preview.tsx",
      "./components/ui/app-video-player.tsx",
    ],
    corePlugins: { preflight: false, backgroundOpacity: false },
  })]).process("@tailwind utilities;", { from: undefined });
  // Keep the generated cascade order; jsdom cannot parse some unrelated
  // arbitrary-value utilities used elsewhere in the full history panel.
  const layoutRules = new Set([".absolute", ".relative", ".inset-0", ".flex", ".h-full", ".w-full", ".pointer-events-none", ".object-contain", ".bg-black"]);
  css = compiled.root.nodes.filter(node => node.type === "rule" && layoutRules.has(node.selector)).map(node => node.toString()).join("\n");
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  stylesheet = document.createElement("style");
  stylesheet.textContent = css;
  document.head.append(stylesheet);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  stylesheet.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("history video loading layout", () => {
  it.each(["9:16", "16:9"])("overlays the poster without shrinking the %s player while loading", async (ratio) => {
    const item = {
      id: ++sequence, type: "video_gen", status: "success", phase: "ready",
      localPath: "/uploads/result.mp4", displayUrl: "/uploads/poster.webp",
      posterUrl: "/uploads/poster.webp", displayKind: "video",
      createdAt: new Date().toISOString(), params: { ratio },
    };
    const otherItem = { ...item, id: item.id + 1000, createdAt: new Date(Date.now() - 60_000).toISOString(), localPath: "/uploads/other.mp4", posterUrl: "/uploads/other.webp", displayUrl: "/uploads/other.webp" };
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const pathname = new URL(url, window.location.origin).pathname;
      if (pathname === "/api/history/summary") return new Response(JSON.stringify({ inProgressCount: 0, completedCount: 1 }));
      if (pathname === "/api/history") return new Response(JSON.stringify({ items: [item, otherItem], hasMore: false }));
      throw new Error(`Unexpected request: ${pathname}`);
    }));
    await act(async () => root.render(React.createElement(UnifiedHistoryPanel, {
      userId: `overlay-layout-${sequence}`, staticVideoPreviews: true,
    })));
    const stage = host.querySelector("[data-video-result-stage]")!;
    const player = stage.querySelector<HTMLElement>("[data-app-video-player]")!;
    const poster = stage.querySelector<HTMLElement>("[data-video-poster-preview]")!;
    const viewport = player.parentElement!;
    const posterLayer = [...viewport.children].find(child => child.contains(poster))!;
    expect(getComputedStyle(posterLayer).position).toBe("absolute");
    expect(getComputedStyle(posterLayer).pointerEvents).toBe("none");
    expect(getComputedStyle(posterLayer).width).toBe("100%");
    expect(getComputedStyle(player).width).toBe("100%");
    expect(getComputedStyle(poster).backgroundColor).toBe("rgb(0, 0, 0)");
    expect(getComputedStyle(poster).backgroundColor).toBe(getComputedStyle(player).backgroundColor);
    expect(getComputedStyle(poster.querySelector("img")!).objectFit).toBe("contain");
    const video = player.querySelector("video")!;
    expect(video.dataset.videoReady).toBe("false");
    act(() => video.dispatchEvent(new Event("loadeddata")));
    expect(stage.querySelector("[data-video-poster-preview]")).toBeNull();
    expect(video.dataset.videoReady).toBe("true");
    expect(getComputedStyle(player).width).toBe("100%");
    // Switching away and back must keep the loading matte identical to playback.
    for (const id of [otherItem.id, item.id]) {
      await act(async () => host.querySelector<HTMLButtonElement>(`[data-history-thumbnail="item:${id}"] button[aria-label="查看"]`)!.click());
      const nextPoster = stage.querySelector("[data-video-poster-preview]")!;
      expect(nextPoster).not.toBeNull();
      expect(getComputedStyle(nextPoster).backgroundColor).toBe(getComputedStyle(player).backgroundColor);
      expect(getComputedStyle(nextPoster).backgroundColor).toBe("rgb(0, 0, 0)");
      act(() => video.dispatchEvent(new Event("loadeddata")));
      expect(stage.querySelector("[data-video-poster-preview]")).toBeNull();
      expect(getComputedStyle(player).backgroundColor).toBe("rgb(0, 0, 0)");
    }
  });
});
