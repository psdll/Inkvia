import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ user: { id: 8100, username: "preview-test" } }));
vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => ({ user: state.user, openLoginModal: vi.fn() }) }));
vi.mock("@/components/ui/hover-preview-video", () => ({ HoverPreviewVideo: () => null }));
vi.mock("@/components/ui/app-video-player", () => ({ AppVideoPlayer: () => null }));
vi.mock("@/components/ui/resilient-image", () => ({
  ResilientImage: () => null,
  warmResilientImageCandidatesBatch: () => () => {},
}));
import { MediaLibraryPanel } from "@/components/media-library/media-library-panel";

let host: HTMLDivElement;
let root: Root;
let entries: ReturnType<typeof item>[];
const onClose = vi.fn();
function item(id: number, title: string, fileUrl: string, kind = "image") {
  return { id, title, fileUrl, kind, scope: "shared", thumbnailUrl: null, tags: [], canDelete: false };
}
const dialog = () => document.querySelector('[role="dialog"]')!;
const button = (label: string) => dialog().querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
async function click(label: string) {
  expect(button(label)).not.toBeNull();
  await act(async () => button(label)!.click());
}
async function key(value: string) {
  await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: value, bubbles: true })));
}
async function openCard(index: number) {
  await act(async () => root.render(React.createElement(MediaLibraryPanel, { open: true, onClose })));
  await act(async () => new Promise((resolve) => setTimeout(resolve, 220)));
  const cards = host.querySelectorAll<HTMLElement>('.media-library-card-button [role="button"]');
  await act(async () => cards[index].click());
}

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  state.user = { ...state.user, id: state.user.id + 1 };
  onClose.mockReset();
  entries = [item(30, "first.jpg", "/first.jpg"), item(10, "second.jpg", "/second.jpg"), item(20, "third.jpg", "/third.jpg")];
  vi.stubGlobal("fetch", vi.fn(async (url: string) => ({
    ok: true,
    json: async () => url === "/api/media-library/folders" ? { folders: [] } : {
      items: entries, groups: [], pagination: { page: 1, total: entries.length, pageSize: 5000, totalPages: 1, hasMore: false },
    },
  })));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("navigates the displayed order by buttons and arrows, stops at boundaries and resets zoom", async () => {
  await openCard(1);
  expect(dialog().textContent).toContain("second.jpg");
  expect(dialog().textContent).toContain("2 / 3");
  await click("放大");
  expect(dialog().textContent).toContain("125%");
  await click("下一张");
  expect(dialog().textContent).toContain("third.jpg");
  expect(dialog().textContent).toContain("3 / 3");
  expect(dialog().textContent).toContain("100%");
  expect(button("下一张")).toBeNull();
  await key("ArrowRight");
  expect(dialog().textContent).toContain("third.jpg");
  await key("ArrowLeft");
  expect(dialog().textContent).toContain("second.jpg");
  await click("上一张");
  expect(dialog().textContent).toContain("first.jpg");
  expect(button("上一张")).toBeNull();
  await key("ArrowLeft");
  expect(dialog().textContent).toContain("1 / 3");
  await key("ArrowRight");
  expect(dialog().textContent).toContain("2 / 3");
  await key("Escape");
  expect(dialog()).toBeNull();
  expect(onClose).not.toHaveBeenCalled();
  await key("Escape");
  expect(onClose).toHaveBeenCalledOnce();
});

it("tracks identical URLs by item ID and skips unavailable or audio entries", async () => {
  entries = [item(1, "first.jpg", "/same.jpg"), item(2, "missing", ""), item(3, "sound", "/sound.mp3", "audio"), item(4, "last.jpg", "/same.jpg")];
  await openCard(0);
  expect(dialog().textContent).toContain("1 / 2");
  await click("下一张");
  expect(dialog().textContent).toContain("last.jpg");
  expect(dialog().textContent).toContain("2 / 2");
  expect(button("下一张")).toBeNull();
});

it("does not offer navigation outside a single-item result", async () => {
  entries = [item(9, "only.jpg", "/only.jpg")];
  await openCard(0);
  expect(dialog().textContent).toContain("1 / 1");
  expect(button("上一张")).toBeNull();
  expect(button("下一张")).toBeNull();
});
