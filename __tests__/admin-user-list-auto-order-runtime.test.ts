/** @vitest-environment ./__tests__/jsdom-no-canvas-environment.ts */
import * as React from "react";
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import UserListSidebar, { type UserListItem } from "@/components/admin/UserListSidebar";

// Keep the virtual list's scroll container and rendered rows observable in jsdom.
vi.mock("react-virtuoso", () => ({
  Virtuoso: React.forwardRef(function VirtualList(props: any, ref) {
    React.useImperativeHandle(ref, () => ({ scrollToIndex: vi.fn() }));
    return React.createElement("div", { "data-virtual-scroller": "true" }, props.data.map((item: UserListItem, index: number) => (
      React.createElement(React.Fragment, { key: props.computeItemKey(index, item) }, props.itemContent(index, item))
    )));
  }),
}));

let root: Root;
let host: HTMLDivElement;
let props: React.ComponentProps<typeof UserListSidebar>;
let desktop: boolean;
let mediaChanged: () => void;
const users = (...keys: string[]): UserListItem[] => keys.map((key) => ({
  adminKey: key, userId: key, username: key, lastCreatedAt: null,
  generationCount: 0, failureRate: 0, summary: [],
}));
const render = (patch: Partial<typeof props> = {}) => act(() => {
  props = { ...props, ...patch };
  root.render(React.createElement(UserListSidebar, props));
});
const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms));
const sidebar = () => host.querySelector(`[data-user-list-viewport="${desktop ? "desktop" : "mobile"}"]`)!;
const order = () => Array.from(sidebar().querySelectorAll("button div[title]")).map((el) => el.getAttribute("title"));
const pointer = (type: string, pointerType = "mouse") => act(() => {
  const event = new Event(type, { bubbles: true });
  Object.defineProperty(event, "pointerType", { value: pointerType });
  sidebar().dispatchEvent(event);
});
const scroll = (top: number) => act(() => {
  const scroller = sidebar().querySelector('[data-virtual-scroller], .overflow-auto') as HTMLElement;
  scroller.scrollTop = top;
  scroller.dispatchEvent(new Event("scroll"));
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  desktop = true;
  vi.stubGlobal("matchMedia", () => ({
    get matches() { return desktop; },
    addEventListener: (_: string, listener: () => void) => { mediaChanged = listener; },
    removeEventListener: vi.fn(),
  }));
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  props = {
    q: "", setQ: vi.fn(), users: users("A", "B", "C"), activeUser: "B",
    setActiveUser: vi.fn(), onRequestDelete: vi.fn(), onRequestExport: vi.fn(),
    onRequestImport: vi.fn(), exportLoadingKey: null,
  };
  render();
  advance(2000);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("automatic admin user ranking", () => {
  it("updates an idle top-of-list without selecting or scrolling to another user", () => {
    render({ users: users("C", "A", "B") });
    advance(1);
    expect(order()).toEqual(["C", "A", "B"]);
    expect(sidebar().querySelector('[data-active="true"]')?.textContent).toContain("B");
    expect(props.setActiveUser).not.toHaveBeenCalled();
    expect(HTMLElement.prototype.scrollIntoView).not.toHaveBeenCalled();
  });

  it("waits while hovered and applies the latest ranking two seconds after leaving", () => {
    pointer("pointerover");
    render({ users: users("C", "A", "B") });
    advance(10000);
    expect(order()).toEqual(["A", "B", "C"]);
    expect(sidebar().textContent).toContain("有新的生成活动");
    pointer("pointerout");
    advance(1500);
    render({ users: users("B", "C", "A") });
    advance(499);
    expect(order()).toEqual(["A", "B", "C"]);
    advance(1);
    expect(order()).toEqual(["B", "C", "A"]);
  });

  it("cancels a pending update when the pointer re-enters", () => {
    pointer("pointerover");
    render({ users: users("C", "A", "B") });
    pointer("pointerout");
    advance(1000);
    pointer("pointerover");
    advance(5000);
    expect(order()).toEqual(["A", "B", "C"]);
  });

  it.each([3, 100])("keeps a scrolled %i-user list stable until it returns to the top", (count) => {
    const keys = Array.from({ length: count }, (_, i) => `user-${i}`);
    render({ users: users(...keys) });
    advance(1);
    scroll(160);
    const next = [...keys].reverse();
    render({ users: users(...next) });
    advance(10000);
    expect(order()).toEqual(keys);
    scroll(0);
    advance(1999);
    expect(order()).toEqual(keys);
    advance(1);
    expect(order()).toEqual(next);
  });

  it("protects keyboard focus until the user moves out of the list", () => {
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
      (sidebar().querySelector('[data-active="true"] button') as HTMLButtonElement).focus();
    });
    render({ users: users("C", "A", "B") });
    advance(5000);
    expect(order()).toEqual(["A", "B", "C"]);
    act(() => (document.activeElement as HTMLElement).blur());
    advance(2000);
    expect(order()).toEqual(["C", "A", "B"]);
  });

  it("keeps search results stable but still allows an explicit update", () => {
    render({ q: "user" });
    render({ users: users("C", "A", "B") });
    advance(5000);
    expect(order()).toEqual(["A", "B", "C"]);
    act(() => Array.from(sidebar().querySelectorAll("button")).find((b) => b.textContent?.trim() === "更新排序")!.click());
    expect(order()).toEqual(["C", "A", "B"]);
    expect(props.setActiveUser).not.toHaveBeenCalled();
  });

  it("honors the global refresh even while automatic sorting is paused", () => {
    pointer("pointerover");
    render({ users: users("C", "A", "B") });
    render({ orderRefreshSignal: 1 });
    expect(order()).toEqual(["C", "A", "B"]);
    expect(props.setActiveUser).not.toHaveBeenCalled();
  });

  it("protects touch interaction and uses only the currently visible viewport", () => {
    scroll(200);
    act(() => { desktop = false; mediaChanged(); });
    advance(2000);
    pointer("pointerdown", "touch");
    render({ users: users("C", "A", "B") });
    advance(5000);
    expect(order()).toEqual(["A", "B", "C"]);
    pointer("pointerup", "touch");
    advance(2000);
    expect(order()).toEqual(["C", "A", "B"]);
  });

  it("clears stale interaction locks when the desktop sidebar is reopened", () => {
    pointer("pointerover");
    render({ collapsed: true, users: users("C", "A", "B") });
    advance(3000);
    render({ collapsed: false });
    advance(2000);
    expect(order()).toEqual(["C", "A", "B"]);
  });
});
