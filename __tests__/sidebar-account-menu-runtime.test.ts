// @vitest-environment jsdom
import * as React from "react";
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AccountMenu } from "@/components/settings/account-menu";

const auth = vi.hoisted(() => ({ user: null as any, loading: false, openLoginModal: vi.fn(), openAccountSwitchModal: vi.fn(), logout: vi.fn() }));
vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => auth }));
vi.mock("next/link", () => ({ default: ({ children, prefetch, ...props }: any) => React.createElement("a", props, children) }));
let host: HTMLDivElement;
let root: Root;
let onFeedback: ReturnType<typeof vi.fn>;
let onSettingsNavigate: ReturnType<typeof vi.fn>;
function button(text: string) { return [...host.querySelectorAll("button")].find(node => node.textContent?.trim() === text)!; }
async function mount() {
  await act(async () => root.render(React.createElement(AccountMenu, {
    onFeedback, onSettingsNavigate, onWarmSettings: vi.fn(), docsHref: "", onMissingDocs: vi.fn(),
    children: (toggle, open) => React.createElement("button", { onClick: toggle, "aria-expanded": open }, "宠物"),
  })));
}
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  auth.user = null; auth.logout.mockResolvedValue(undefined);
  onFeedback = vi.fn(); onSettingsNavigate = vi.fn();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await mount();
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("opens the same account panel for a guest without starting login", async () => {
  expect(host.querySelector('[role="dialog"]')).toBeNull();
  await act(async () => button("宠物").click());
  expect(auth.openLoginModal).not.toHaveBeenCalled();
  expect(host.querySelector('[role="dialog"]')?.textContent).toContain("未登录");
  expect(host.querySelector('a[href="/settings"]')).not.toBeNull();
  expect(host.querySelector('a[href="/settings#usage"]')).not.toBeNull();
  expect(button("退出登录")).toBeUndefined();
  await act(async () => button("登录 / 注册").click());
  expect(auth.openLoginModal).toHaveBeenCalledOnce();
  expect(host.querySelector('[role="dialog"]')).toBeNull();
});

it("toggles closed and dismisses with Escape or an outside click", async () => {
  await act(async () => button("宠物").click());
  await act(async () => button("宠物").click());
  expect(host.querySelector('[role="dialog"]')).toBeNull();
  await act(async () => button("宠物").click());
  await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  expect(document.activeElement).toBe(button("宠物"));
  expect(host.querySelector('[role="dialog"]')).toBeNull();
  await act(async () => button("宠物").click());
  await act(async () => document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })));
  expect(host.querySelector('[role="dialog"]')).toBeNull();
});

it("shows the current account and opens switching without logging out", async () => {
  auth.user = { id: 7, username: "原账号" };
  await mount();
  await act(async () => button("宠物").click());
  expect(host.textContent).toContain("原账号");
  expect(host.textContent).toContain("UID：7");
  await act(async () => button("切换账号").click());
  expect(auth.openAccountSwitchModal).toHaveBeenCalledOnce();
  expect(auth.logout).not.toHaveBeenCalled();
  expect(host.querySelector('[role="dialog"]')).toBeNull();
});

it("logs out only on the explicit logout action", async () => {
  auth.user = { id: 7, username: "原账号" };
  await mount();
  await act(async () => button("宠物").click());
  expect(auth.logout).not.toHaveBeenCalled();
  await act(async () => button("退出登录").click());
  expect(auth.logout).toHaveBeenCalledWith({ reload: false });
  expect(host.querySelector('[role="dialog"]')).toBeNull();
});

it("opens existing feedback and warms/navigates to settings from the panel", async () => {
  await act(async () => button("宠物").click());
  await act(async () => button("问题反馈").click());
  expect(onFeedback).toHaveBeenCalledOnce();
  expect(host.querySelector('[role="dialog"]')).toBeNull();
  await act(async () => button("宠物").click());
  const settings = host.querySelector<HTMLAnchorElement>('a[href="/settings"]')!;
  settings.addEventListener("click", event => event.preventDefault());
  await act(async () => settings.click());
  expect(onSettingsNavigate).toHaveBeenCalledOnce();
  expect(host.querySelector('[role="dialog"]')).toBeNull();
});
