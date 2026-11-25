import * as React from "react";
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useAdminStorage } from "@/lib/hooks/use-admin-storage";
import { AdminSessionGate } from "@/components/admin/AdminSessionGate";

vi.mock("@/lib/client/inflight-json", () => ({ fetchJsonOnce: async () => ({ ok: true, json: { authenticated: true } }) }));

let root: Root;
let host: HTMLDivElement;
let client: QueryClient;
let storage: ReturnType<typeof useAdminStorage>;
function Consumer() {
  storage = useAdminStorage({ enabled: false });
  return React.createElement("div", null, storage.storageErr || "后台内容");
}
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  await act(async () => root.render(React.createElement(QueryClientProvider, { client },
    React.createElement(AdminSessionGate, null, React.createElement(Consumer)))));
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  client.clear();
  vi.unstubAllGlobals();
});

it("handles expired manual/prefetch requests without a rejected promise and replaces the admin screen", async () => {
  const request = vi.fn(async () => new Response(JSON.stringify({ error: "未登录管理员" }), { status: 401 }));
  vi.stubGlobal("fetch", request);
  await act(async () => { await expect(storage.loadStorage({ force: true })).resolves.toBeNull(); });
  expect(request).toHaveBeenCalledTimes(1);
  expect(host.textContent).toContain("管理员登录已过期");
  expect(host.textContent).not.toContain("后台内容");
  expect(host.querySelector("a")?.getAttribute("href")).toBe("/settings?admin=1");
});

it("shows ordinary server failures without logging the administrator out", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "暂时无法读取存储" }), { status: 500 })));
  await act(async () => { await expect(storage.loadStorage()).resolves.toBeNull(); });
  expect(host.textContent).toContain("暂时无法读取存储");
  expect(host.textContent).not.toContain("管理员登录已过期");
});

it("handles network rejection without an unhandled promise", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("网络连接中断")));
  await act(async () => { await expect(storage.loadStorage()).resolves.toBeNull(); });
  expect(host.textContent).toContain("网络连接中断");
});

it("handles expiry when saving storage settings", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 401 })));
  await act(async () => { await expect(storage.saveStorageLimits()).resolves.toBeUndefined(); });
  expect(host.textContent).toContain("管理员登录已过期");
});

it("keeps successful storage loads working", async () => {
  const payload = { totalStorageGB: 20, warnPercent: 70, criticalPercent: 85 };
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(payload)));
  await act(async () => { await expect(storage.loadStorage()).resolves.toEqual(payload); });
  expect(host.textContent).not.toContain("管理员登录已过期");
});
