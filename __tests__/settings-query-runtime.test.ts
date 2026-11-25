import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ user: { id: "account-a", username: "A", isAdmin: true } }));
vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => ({ user: auth.user, openLoginModal: vi.fn() }) }));
vi.mock("@/components/ui/frosted-select", () => ({
  FrostedSelect: ({ value, onChange, options }: any) => React.createElement("select", {
    value, onChange: (event: any) => onChange(event.target.value),
  }, options.map((option: any) => React.createElement("option", { key: option.value, value: option.value }, option.label))),
}));

import { ModelUsagePanel } from "@/components/settings/model-usage-panel";
import { ProfileCard } from "@/components/settings/profile-card";
import { SettingsLogsPanel } from "@/components/settings/logs-panel";

let root: Root;
let host: HTMLDivElement;
let client: QueryClient;
let request: ReturnType<typeof vi.fn>;
const usage = (total: number) => ({ month: "2026-09", totalAmount: String(total), pendingCount: 0, daily: [] });
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });

async function show(panel: React.ReactNode) {
  await act(async () => root.render(React.createElement(QueryClientProvider, { client },
    React.createElement(React.StrictMode, null, panel))));
  await act(async () => { await vi.advanceTimersByTimeAsync(5); });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  auth.user = { id: "account-a", username: "A", isAdmin: true };
  client = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: false, refetchOnWindowFocus: false } } });
  request = vi.fn(async (url: string) => {
    if (url === "/api/settings/monthly-spending") return json(usage(321));
    if (url === "/api/auth/me/stats") return json({ stats: { totalGenerations: 123, totalAttempts: 125, successRate: 98, recent7Count: 8 } });
    if (url === "/api/logs/stats") return json({ success: true, data: { totalLogs: 1, errorLogs: 0, categoryStats: {}, levelStats: {}, generationTaskCount: 0 } });
    if (url.startsWith("/api/logs?")) return json({ success: true, data: [], pagination: { totalPages: 1 } });
    throw new Error(`Unexpected request: ${url}`);
  });
  vi.stubGlobal("fetch", request);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  client.clear();
  host.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("settings data across navigation", () => {
  it("shows daily currency values including zero through the shared chart and preserves refresh", async () => {
    request.mockResolvedValueOnce(json({ month: "2026-10", totalAmount: "1.23", pendingCount: 0,
      daily: [{ day: "2026-10-01", amount: "0.00" }, { day: "2026-10-02", amount: "1.23" }] }));
    await show(React.createElement(ModelUsagePanel));
    const cells = host.querySelectorAll<SVGRectElement>('[aria-label="本月每日消费图表"] [role="button"]');
    expect(cells).toHaveLength(2);
    act(() => cells[0].focus());
    expect(host.querySelector('[role="tooltip"]')?.textContent).toContain("2026年10月1日消费金额¥0.00");
    act(() => cells[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
    expect(host.querySelector('[role="tooltip"]')?.textContent).toContain("2026年10月2日消费金额¥1.23");
    expect(host.querySelector('[role="tooltip"]')?.textContent).not.toContain("合计");
    await act(async () => (host.querySelector('[aria-label="刷新消费统计"]') as HTMLButtonElement).click());
    await act(async () => { await vi.advanceTimersByTimeAsync(5); });
    expect(request).toHaveBeenCalledTimes(2);
    expect(host.textContent).toContain("¥321.00");
  });

  it("deduplicates Strict Mode and reuses model statistics on a quick return", async () => {
    await show(React.createElement(ModelUsagePanel));
    expect(host.textContent).toContain("¥321.00");
    expect(request).toHaveBeenCalledTimes(1);
    await show(null);
    await show(React.createElement(ModelUsagePanel));
    expect(host.textContent).toContain("¥321.00");
    expect(host.textContent).not.toContain("正在加载消费统计");
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("keeps cached statistics visible while a stale query refreshes or fails", async () => {
    await show(React.createElement(ModelUsagePanel));
    await show(null);
    await client.invalidateQueries({ queryKey: ["settings"], refetchType: "none" });
    let finish!: (response: Response) => void;
    request.mockImplementationOnce(() => new Promise<Response>((resolve) => { finish = resolve; }));
    await show(React.createElement(ModelUsagePanel));
    expect(host.textContent).toContain("¥321.00");
    expect(host.textContent).not.toContain("正在加载消费统计");
    await act(async () => { finish(json({ error: "Temporarily unavailable" }, 503)); });
    await act(async () => { await vi.advanceTimersByTimeAsync(5); });
    expect(host.textContent).toContain("¥321.00");
  });

  it("does not show the previous account's cached statistics while the next account loads", async () => {
    await show(React.createElement(ModelUsagePanel));
    let finish!: (response: Response) => void;
    request.mockImplementationOnce(() => new Promise<Response>((resolve) => { finish = resolve; }));
    auth.user = { id: "account-b", username: "B", isAdmin: true };
    await show(React.createElement(ModelUsagePanel));
    expect(host.textContent).not.toContain("¥321.00");
    expect(host.textContent).toContain("正在加载消费统计");
    await act(async () => { finish(json(usage(5))); });
    await act(async () => { await vi.advanceTimersByTimeAsync(5); });
    expect(host.textContent).toContain("¥5.00");
  });

  it("reuses the account overview instead of clearing its counters on remount", async () => {
    await show(React.createElement(ProfileCard));
    expect(host.textContent).toContain("123");
    await show(null);
    await show(React.createElement(ProfileCard));
    expect(host.textContent).toContain("123");
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("caches log pages independently without refetching unfiltered statistics on every filter change", async () => {
    await show(React.createElement(SettingsLogsPanel));
    expect(request.mock.calls.filter(([url]) => url === "/api/logs/stats")).toHaveLength(1);
    await show(null);
    await show(React.createElement(SettingsLogsPanel));
    expect(request).toHaveBeenCalledTimes(2);
    const category = host.querySelector("select")!;
    await act(async () => {
      category.value = "generation";
      category.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(5); });
    expect(request.mock.calls.some(([url]) => url.includes("category=generation"))).toBe(true);
    expect(request.mock.calls.filter(([url]) => url === "/api/logs/stats")).toHaveLength(1);
  });

  it("invalidates cached log filters after clearing logs so a quick return reads fresh data", async () => {
    await show(React.createElement(SettingsLogsPanel));
    const category = host.querySelector("select")!;
    await act(async () => {
      category.value = "generation";
      category.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(5); });

    const openClear = Array.from(host.querySelectorAll("button")).find((button) => button.textContent?.trim() === "清空日志")!;
    await act(async () => openClear.click());
    const confirm = Array.from(document.body.querySelectorAll("button")).find((button) => button.textContent?.trim() === "清空")!;
    request.mockImplementationOnce(async () => json({ success: true }));
    await act(async () => confirm.click());
    await act(async () => { await vi.advanceTimersByTimeAsync(5); });
    expect(request).toHaveBeenCalledWith("/api/logs?category=generation", { method: "DELETE" });
    expect(request.mock.calls.filter(([url]) => url === "/api/logs/stats")).toHaveLength(2);

    await act(async () => {
      category.value = "api";
      category.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(5); });
    expect(request.mock.calls.filter(([url]) => url === "/api/logs?page=1&limit=50&category=api")).toHaveLength(2);
  });
});
