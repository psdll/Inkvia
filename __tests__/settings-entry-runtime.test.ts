import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ user: { id: 7, username: "Account A", isAdmin: true } as any, loading: false, search: "" }));
const router = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));
vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => ({ ...auth, logout: vi.fn(), openLoginModal: vi.fn() }) }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(auth.search),
  useRouter: () => router,
}));
vi.mock("next/link", () => ({ default: ({ children, prefetch, ...props }: any) => React.createElement("a", props, children) }));
import SettingsPage from "@/app/settings/page";
import { ProfileCard } from "@/components/settings/profile-card";
import { MaterialTools } from "@/components/settings/material-tools";
import { AppQueryClientProvider } from "@/components/system/query-client-provider";

let client: QueryClient;
let host: HTMLDivElement;
let root: Root;
let request: ReturnType<typeof vi.fn>;
let pending: Array<(value: Response) => void>;
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
async function show(component: React.ReactNode = React.createElement(SettingsPage)) {
  await act(async () => root.render(React.createElement(QueryClientProvider, { client }, component)));
  await act(async () => { await vi.advanceTimersByTimeAsync(5); });
}
function button(text: string) { return [...host.querySelectorAll("button")].find(b => b.textContent === text)!; }
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
  vi.useFakeTimers();
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  Object.defineProperty(navigator, "clipboard", { configurable: true, get: () => undefined });
  localStorage.clear();
  window.history.replaceState(null, "", "/settings");
  pending = [];
  auth.user = { id: 7, username: "Account A", isAdmin: true }; auth.loading = false; auth.search = "";
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000 } } });
  request = vi.fn(async (url: string) => url === "/api/auth/me/stats"
    ? json({ stats: { totalGenerations: 123, totalAttempts: 125, recent7Count: 8, successRate: 98 } })
    : url === "/api/settings/monthly-spending" ? json({ month: "2026-09", totalAmount: "0.00", pendingCount: 0, daily: [] })
    : url === "/api/admin/session" ? json({}, 401)
    : json({ canUploadMaterial: true, hasMaterialInspirations: true }));
  vi.stubGlobal("fetch", request);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  await act(async () => { pending.forEach(resolve => resolve(json({}))); });
  client.clear(); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers();
});

it("shows statistics on the same page without fetching material permissions", async () => {
  await show();
  expect(request).not.toHaveBeenCalled();
  expect(host.textContent).toContain("生成快捷键");
  await act(async () => button("使用统计").click());
  await act(async () => { await vi.advanceTimersByTimeAsync(5); });
  expect(request.mock.calls.map(([url]) => url).sort()).toEqual(["/api/auth/me/stats", "/api/settings/monthly-spending"]);
  expect(host.querySelector('[aria-label="每月消费统计"]')).not.toBeNull();
  expect(host.textContent).toContain("累计成功生成123条");
  expect(host.querySelector('a[href="/usage"]')).toBeNull();
});

it("keeps preferences interactive after leaving pending statistics", async () => {
  request.mockImplementation(() => new Promise(resolve => pending.push(resolve)));
  await show();
  await act(async () => button("使用统计").click());
  expect(request.mock.calls.map(([url]) => url).sort()).toEqual(["/api/auth/me/stats", "/api/settings/monthly-spending"]);
  await act(async () => button("通用设置").click());
  await act(async () => button("修改").click());
  expect(host.textContent).toContain("等待按键");
  await act(async () => button("取消").click());
  expect(host.textContent).not.toContain("等待按键");
});

it("switches tabs with keyboard arrows without leaving the settings route", async () => {
  await show();
  await act(async () => button("通用设置").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
  expect(button("使用统计").getAttribute("aria-selected")).toBe("true");
  expect(window.location.pathname).toBe("/settings");
  await act(async () => button("使用统计").dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true })));
  expect(button("通用设置").getAttribute("aria-selected")).toBe("true");
});

it("keeps preferences usable while authentication is pending and Escape cancels recording", async () => {
  auth.loading = true; auth.user = null;
  localStorage.setItem("settings_hotkey_generate_v1", "Alt+Enter");
  await show();
  await act(async () => button("修改").click());
  expect(host.textContent).toContain("等待按键");
  await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true })));
  expect(host.textContent).not.toContain("等待按键");
  expect(localStorage.getItem("settings_hotkey_generate_v1")).toBe("Alt+Enter");
  expect(request).not.toHaveBeenCalled();
});

it("rejects browser shortcuts and saves valid combinations to the existing key", async () => {
  await show();
  await act(async () => button("修改").click());
  await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "r", code: "KeyR", ctrlKey: true, bubbles: true })));
  expect(host.textContent).toContain("可能与浏览器");
  expect(localStorage.getItem("settings_hotkey_generate_v1")).toBeNull();
  await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", altKey: true, bubbles: true })));
  expect(localStorage.getItem("settings_hotkey_generate_v1")).toBe("Alt+Enter");
  expect(host.textContent).toContain("已保存");
});

it("does not claim a shortcut was saved when browser storage fails", async () => {
  await show();
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
  await act(async () => button("恢复默认").click());
  expect(host.textContent).toContain("保存失败");
  expect(host.textContent).not.toContain("已保存");
});

it("applies and persists theme selection and responds to the shared theme switch", async () => {
  await show();
  await act(async () => button("浅色").click());
  expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  expect(localStorage.getItem("app-theme")).toBe("light");
  await act(async () => { localStorage.setItem("app-theme", "dark"); window.dispatchEvent(new CustomEvent("settings:theme")); });
  expect(button("深色").getAttribute("aria-pressed")).toBe("true");
});

it("reuses prefetched statistics and permissions without growing requests across 50 entries", async () => {
  const { warmSettingsEntry } = await import("@/lib/client/settings-queries");
  await warmSettingsEntry(client, "7");
  const content = React.createElement(React.Fragment, null, React.createElement(ProfileCard), React.createElement(MaterialTools));
  await show(content);
  expect(host.textContent).toContain("123");
  for (let i = 0; i < 50; i++) { await act(async () => root.render(null)); await show(content); }
  expect(request).toHaveBeenCalledTimes(2);
  expect(client.getQueryCache().getAll()).toHaveLength(2);
});

it("does not show account A statistics or permissions while account B is loading", async () => {
  const content = () => React.createElement(React.Fragment, null, React.createElement(ProfileCard), React.createElement(MaterialTools));
  await show(content());
  request.mockImplementation(() => new Promise(resolve => pending.push(resolve)));
  auth.user = { id: 8, username: "Account B", isAdmin: false };
  await show(content());
  expect(host.textContent).not.toContain("123");
  expect(host.textContent).not.toContain("上传素材");
});

it("shows failed initial statistics as unavailable instead of a false zero", async () => {
  request.mockImplementation(async () => json({}, 503));
  await show(React.createElement(ProfileCard));
  expect(host.textContent).toContain("统计暂不可用");
  expect(host.textContent).not.toContain("0%");
});

it("clears settings on logout so a late response cannot restore the previous account cache", async () => {
  let shared!: QueryClient;
  function CacheProbe() { shared = useQueryClient(); return null; }
  await act(async () => root.render(React.createElement(AppQueryClientProvider, null, React.createElement(CacheProbe))));
  shared.setQueryData(["settings", "7", "entry"], { canUploadMaterial: true });
  shared.setQueryData(["unrelated"], "retained");
  let finish!: (value: string) => void;
  const warming = shared.prefetchQuery({ queryKey: ["settings", "7", "profile"], queryFn: () => new Promise<string>(resolve => { finish = resolve; }) });
  await act(async () => { window.dispatchEvent(new Event("auth:logout")); });
  finish("old account");
  await warming;
  expect(shared.getQueryCache().findAll({ queryKey: ["settings"] })).toHaveLength(0);
  expect(shared.getQueryData(["unrelated"])).toBe("retained");
  shared.clear();
});


it("copies the UID text without an icon and renews the temporary toast on repeat clicks", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.spyOn(navigator, "clipboard", "get").mockReturnValue({ writeText } as any);
  await show();
  const uid = button("UID：7");
  expect(uid.querySelector("svg")).toBeNull();
  await act(async () => uid.click());
  expect(writeText).toHaveBeenCalledWith("7");
  expect(host.textContent).toContain("已复制到粘贴板。");
  await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
  await act(async () => uid.click());
  await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
  expect(host.textContent).toContain("已复制到粘贴板。");
  await act(async () => { await vi.advanceTimersByTimeAsync(501); });
  expect(host.textContent).not.toContain("已复制到粘贴板。");
});

it("does not show a success toast when copying fails", async () => {
  vi.spyOn(navigator, "clipboard", "get").mockReturnValue({ writeText: vi.fn().mockRejectedValue(new Error("denied")) } as any);
  await show();
  await act(async () => button("UID：7").click());
  expect(host.textContent).not.toContain("已复制到粘贴板。");
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("复制失败");
});

it("opens administrator login over settings without changing the route and closes it", async () => {
  await show();
  await act(async () => button("管理控制台").click());
  expect(window.location.pathname + window.location.search).toBe("/settings");
  expect(host.querySelector("dialog[open]")).not.toBeNull();
  expect(host.querySelector('input[type="password"]')).not.toBeNull();
  expect(host.textContent).toContain("生成快捷键");
  expect(button("登录并进入").disabled).toBe(true);
  expect(request.mock.calls.map(([url]) => url)).toEqual(["/api/admin/session"]);
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="关闭管理员登录"]')!.click());
  expect(host.querySelector("dialog")).toBeNull();
  expect(host.textContent).toContain("Account A");
});

it("opens the same dialog for legacy administrator redirects", async () => {
  auth.search = "?admin=1";
  window.history.replaceState(null, "", "/settings?admin=1");
  await show();
  expect(host.querySelector("dialog[open]")).not.toBeNull();
  expect(host.textContent).toContain("生成快捷键");
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="关闭管理员登录"]')!.click());
  expect(window.location.search).toBe("");
});
