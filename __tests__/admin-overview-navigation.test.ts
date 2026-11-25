// @vitest-environment jsdom
import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { act, Simulate } from "react-dom/test-utils";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import AdminOverviewTab, { type AdminOverviewTabProps } from "@/components/admin/AdminOverviewTab";
import { DesktopModeProvider } from "@/components/system/desktop-mode";

vi.mock("@/components/admin/ModelReliabilityPanel", () => ({ default: () => null }));
vi.mock("@/components/settings/account-usage-section", () => ({
  AccountUsageSection: () => React.createElement("div", { "data-testid": "account-usage" }),
}));
let host: HTMLDivElement;
let root: Root;
const save = vi.fn(async () => {});
const cleanup = vi.fn();
function Fixture() {
  const [total, setTotal] = React.useState("50");
  const props: AdminOverviewTabProps = {
    storage: null, storageLoading: false, storageErr: null, storageSaving: false,
    storageTotalGb: total, setStorageTotalGb: setTotal,
    storageWarnPercent: "70", setStorageWarnPercent: vi.fn(),
    storageCriticalPercent: "85", setStorageCriticalPercent: vi.fn(),
    storageSaved: { totalGb: "50", warn: "70", critical: "85" },
    loadStorage: save, saveStorageLimits: save,
    retentionDays: "30", setRetentionDays: vi.fn(), retentionSaved: "30",
    retentionLoading: false, retentionSaving: false, retentionErr: null,
    retentionLastPrunedAt: null, saveRetentionDays: save,
    cleanupDays: "0", setCleanupDays: vi.fn(), cleanupBusy: "", cleanupResult: null,
    onRequestStorageCleanup: cleanup, onViewUser: vi.fn(),
  };
  return React.createElement(AdminOverviewTab, props);
}
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.clearAllMocks();
  sessionStorage.clear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root.render(React.createElement(Fixture)));
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
function tab(key: string) { return host.querySelector(`#admin-page-${key}`) as HTMLButtonElement; }
function visiblePanel() { return host.querySelectorAll('[role="tabpanel"]:not([hidden])'); }

it("shows one category at a time and preserves unsaved storage input without invoking actions", () => {
  expect(visiblePanel()).toHaveLength(1);
  expect(visiblePanel()[0].id).toBe("admin-panel-runtime");
  act(() => tab("storage").click());
  const input = host.querySelector("#storage-total-gb") as HTMLInputElement;
  act(() => { input.value = "60"; Simulate.change(input); });
  act(() => tab("users").click());
  expect(visiblePanel()).toHaveLength(1);
  expect(visiblePanel()[0].id).toBe("admin-panel-users");
  act(() => tab("storage").click());
  expect(input.value).toBe("60");
  expect(tab("storage").getAttribute("aria-selected")).toBe("true");
  expect(save).not.toHaveBeenCalled();
  expect(cleanup).not.toHaveBeenCalled();
});

it("supports keyboard category navigation with focus and one active tab stop", () => {
  act(() => {
    tab("runtime").focus();
    tab("runtime").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
  });
  expect(document.activeElement).toBe(tab("storage"));
  expect(visiblePanel()[0].id).toBe("admin-panel-storage");
  act(() => tab("storage").dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true })));
  expect(document.activeElement).toBe(tab("runtime"));
  expect(host.querySelectorAll('[role="tab"][tabindex="0"]')).toHaveLength(1);
});


it.each(["models", "users", "storage"])("restores the overview %s subpage after a full remount", (page) => {
  act(() => tab(page).click());
  act(() => root.unmount());
  root = createRoot(host);
  act(() => root.render(React.createElement(Fixture)));
  expect(visiblePanel()[0].id).toBe(`admin-panel-${page}`);
});

it("falls back from a saved users tab and skips the removed tab when navigating in desktop mode", () => {
  sessionStorage.setItem("admin-page:overview-page", "users");
  act(() => root.unmount());
  root = createRoot(host);
  act(() => root.render(React.createElement(DesktopModeProvider, {
    value: true,
    children: React.createElement(Fixture),
  })));

  expect(visiblePanel()[0].id).toBe("admin-panel-runtime");
  expect([...host.querySelectorAll('[role="tab"]')].map(node => node.textContent)).toEqual(["本机概况", "模型统计", "本机存储", "使用统计"]);
  expect(host.querySelector("#admin-panel-users")).toBeNull();
  expect(host.querySelector("#storage-total-gb")).toBeNull();
  act(() => tab("models").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
  expect(document.activeElement).toBe(tab("storage"));
  expect(visiblePanel()[0].id).toBe("admin-panel-storage");
  act(() => tab("storage").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
  expect(document.activeElement).toBe(tab("usage"));
  expect(visiblePanel()[0].id).toBe("admin-panel-usage");
  expect(host.querySelector('[data-testid="account-usage"]')).not.toBeNull();
});
