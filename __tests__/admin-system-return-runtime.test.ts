// @vitest-environment jsdom
import * as React from "react";
import { act, Simulate } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams("tab=system&section=tutorial") }));
vi.mock("next/link", () => ({ default: ({ children, ...props }: any) => React.createElement("a", props, children) }));
vi.mock("next/dynamic", () => ({ default: (loader: () => Promise<any>, options: any) => {
  if (!/AdminSystemTab|TutorialDocSection|SystemNoticeSection|BillingPriceRulesPanel/.test(String(loader))) return () => null;
  const Component = React.lazy(loader);
  return (props: any) => React.createElement(React.Suspense, { fallback: options?.loading ? React.createElement(options.loading) : null }, React.createElement(Component, props));
} }));
import AdminPage from "@/app/admin/page";
let root: Root, host: HTMLDivElement, client: QueryClient;
let fetchMock: ReturnType<typeof vi.fn>;
const loadCount = (path: string) => fetchMock.mock.calls.filter(([url]) => String(url) === path).length;
async function settle() {
  // The system workspace and its selected section are independently lazy loaded.
  for (let depth = 0; depth < 3; depth++) await act(async () => { await vi.dynamicImportSettled(); });
}
async function click(name: string) {
  const button = [...host.querySelectorAll("button")].find((button) => button.textContent?.trim() === name)!;
  expect(button).toBeTruthy();
  await act(async () => button.click());
  await settle();
}
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} unobserve() {} });
  Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: vi.fn() });
  fetchMock = vi.fn(async (url: string) => ({ ok: true, json: async () => url === "/api/admin/settings/tutorial-doc" ? { url: "https://example.com/guide" } : url === "/api/admin/billing/catalog" ? { settings: { revision: 0, drafts: [], rates: [], mode: "observe" }, models: [], units: {} } : {} }));
  vi.stubGlobal("fetch", fetchMock);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => root.render(React.createElement(QueryClientProvider, { client }, React.createElement(AdminPage))));
  await settle();
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); client.clear(); vi.unstubAllGlobals(); vi.restoreAllMocks();
});
it("retains a visited settings form and its data when leaving the main system tab and returning", async () => {
  const input = host.querySelector<HTMLInputElement>('input[placeholder="https://..."]')!;
  expect(input).not.toBeNull();
  expect(input.value).toBe("https://example.com/guide");
  await act(async () => Simulate.change(input, { target: { value: "https://example.com/unsaved" } } as any));
  await click("全站通知");
  await click("教程文档链接");
  expect(host.querySelector('input[placeholder="https://..."]')).toBe(input);
  expect(loadCount("/api/admin/settings/tutorial-doc")).toBe(1);
  await click("系统概览");
  await click("系统设置");
  expect(host.querySelector('input[placeholder="https://..."]')).toBe(input);
  expect(input.value).toBe("https://example.com/unsaved");
  expect(loadCount("/api/admin/settings/tutorial-doc")).toBe(1);
  await click("全站通知");
  expect(loadCount("/api/admin/settings/system-notice")).toBe(1);
});

it("reuses price data across navigation but refreshes it on explicit request only", async () => {
  await click("模型价格规则");
  expect(loadCount("/api/admin/billing/catalog")).toBe(1);
  await click("操作日志");
  await click("刷新");
  await click("系统设置");
  expect(loadCount("/api/admin/billing/catalog")).toBe(1);
  // Wait for the top bar's existing minimum refresh indicator duration.
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 520)); });
  await click("刷新");
  expect(loadCount("/api/admin/billing/catalog")).toBe(2);
  await click("教程文档链接");
  await click("模型价格规则");
  expect(loadCount("/api/admin/billing/catalog")).toBe(2);
});


it.each([
  ["系统监控", "monitoring"],
  ["用户管理", "users"],
  ["反馈中心", "feedback_center"],
  ["操作日志", "audit_logs"],
])("keeps %s in the URL after the router next commits its canonical location", async (label, expectedTab) => {
  const replace = window.history.replaceState.bind(window.history);
  let canonicalUrl = "/admin?tab=system&section=tutorial";
  replace({ __NA: true }, "", canonicalUrl);
  // Next's history bridge ignores writes carrying its own internal marker.
  vi.spyOn(window.history, "replaceState").mockImplementation((data, title, url) => {
    if (!data?.__NA && !data?._N && url) canonicalUrl = String(url);
    replace({ ...data, __NA: true }, title, url);
  });
  await click(label);
  replace({ __NA: true }, "", canonicalUrl);
  expect(new URLSearchParams(window.location.search).get("tab")).toBe(expectedTab);
});

it("keeps the selected system section in the router location", async () => {
  const replace = window.history.replaceState.bind(window.history);
  let canonicalUrl = "/admin?tab=system&section=tutorial";
  replace({ __NA: true }, "", canonicalUrl);
  vi.spyOn(window.history, "replaceState").mockImplementation((data, title, url) => {
    if (!data?.__NA && !data?._N && url) canonicalUrl = String(url);
    replace({ ...data, __NA: true }, title, url);
  });
  await click("全站通知");
  replace({ __NA: true }, "", canonicalUrl);
  expect(new URLSearchParams(window.location.search).get("section")).toBe("notice");
});
