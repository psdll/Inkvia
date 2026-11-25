// @vitest-environment ./__tests__/jsdom-no-canvas-environment.ts
import * as React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, expect, it, vi } from "vitest";

const { request, user } = vi.hoisted(() => ({ request: vi.fn(), user: { id: 1 } }));
vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => ({ user, loading: false }) }));
vi.mock("@/lib/client/inflight-json", () => ({ fetchJsonOnce: request }));
vi.mock("@/components/ui/resilient-image", () => ({ ResilientImage: () => null }));
vi.mock("@/components/ui/auto-hide-scrollbar", () => ({ AutoHideScrollbar: () => null }));
vi.mock("next/link", () => ({ default: ({ children, ...props }: any) => React.createElement("a", props, children) }));
import CanvasPage from "@/app/canvas/page";

const container = document.createElement("div");
let root: ReturnType<typeof createRoot>;
afterEach(() => { act(() => root.unmount()); container.replaceChildren(); container.remove(); request.mockReset(); vi.unstubAllGlobals(); });
const payload = (title: string) => ({ ok: true, json: { success: true, items: [{ id: 1, publicId: "one", title, sortOrder: 0, revision: "1", updatedAt: "2026-09-16" }] } });
async function mount() {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  request.mockResolvedValueOnce(payload("正常项目"));
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root.render(React.createElement(CanvasPage)); });
}
function toggle() { return container.querySelector<HTMLButtonElement>("button[aria-busy]")!; }
it("dismisses project actions outside and on page scroll while preserving menu interactions", async () => {
  await mount();
  const trigger = container.querySelector<HTMLButtonElement>('[aria-label="项目操作"]')!;
  const action = () => [...container.querySelectorAll("button")].find(button => button.textContent === "重命名");
  await act(async () => trigger.click());
  expect(action()).toBeDefined();
  await act(async () => action()!.dispatchEvent(new Event("pointerdown", { bubbles: true })));
  expect(action()).toBeDefined();
  await act(async () => document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })));
  expect(action()).toBeUndefined();
  await act(async () => trigger.click());
  await act(async () => container.querySelector("main")!.dispatchEvent(new Event("scroll")));
  expect(action()).toBeUndefined();
  await act(async () => trigger.click());
  await act(async () => { trigger.dispatchEvent(new Event("pointerdown", { bubbles: true })); trigger.click(); });
  expect(action()).toBeUndefined();
  await act(async () => trigger.click());
  await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
  expect(action()).toBeUndefined();
});
it("switches heading and items together after loading in both directions", async () => {
  await mount();
  let resolve!: (value: any) => void;
  request.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
  act(() => toggle().click());
  expect(container.querySelector("h1")?.textContent).toBe("全部项目");
  expect(container.textContent).toContain("正常项目");
  expect(toggle().disabled).toBe(true);
  await act(async () => { resolve(payload("已删除项目")); });
  expect(container.querySelector("h1")?.textContent).toBe("回收站");
  expect(container.textContent).toContain("已删除项目");
  expect(container.textContent).not.toContain("正常项目");
  expect(request).toHaveBeenCalledTimes(2);
  request.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
  act(() => toggle().click());
  expect(container.querySelector("h1")?.textContent).toBe("回收站");
  await act(async () => { resolve(payload("正常项目")); });
  expect(container.querySelector("h1")?.textContent).toBe("全部项目");
  expect(container.textContent).not.toContain("已删除项目");
  expect(request).toHaveBeenCalledTimes(3);
});
it("retains the current view on failure and allows retry", async () => {
  await mount();
  request.mockRejectedValueOnce(new Error("offline"));
  await act(async () => { toggle().click(); });
  expect(container.querySelector("h1")?.textContent).toBe("全部项目");
  expect(container.textContent).toContain("正常项目");
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("加载项目失败");
  expect(toggle().disabled).toBe(false);
  request.mockResolvedValueOnce({ ok: true, json: { success: true, items: [] } });
  await act(async () => { toggle().click(); });
  expect(container.querySelector("h1")?.textContent).toBe("回收站");
  expect(container.textContent).toContain("回收站为空");
});

async function openDelete() {
  act(() => container.querySelector<HTMLButtonElement>('button[aria-label="项目操作"]')!.click());
  act(() => Array.from(container.querySelectorAll("button")).find(button => button.textContent === "删除项目")!.click());
}
function confirmDelete() {
  return Array.from(document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')).find(button => button.textContent === "移入回收站")!;
}
it("closes deletion immediately on server success without waiting for a list reload", async () => {
  await mount();
  request.mockImplementation(() => new Promise(() => {}));
  let resolveDelete!: (value: Response) => void;
  const remove = vi.fn(() => new Promise<Response>(resolve => { resolveDelete = resolve; }));
  vi.stubGlobal("fetch", remove);
  await openDelete();
  act(() => confirmDelete().click());
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain("处理中");
  expect(container.textContent).toContain("正常项目");
  await act(async () => { resolveDelete(new Response(JSON.stringify({ success: true }), { status: 200 })); });
  expect(remove).toHaveBeenCalledWith("/api/canvas/1", { method: "DELETE" });
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(container.textContent).not.toContain("正常项目");
  expect(request).toHaveBeenCalledTimes(1);
});
it.each(["server", "network"])("keeps the project and shows an actionable error on %s deletion failure", async (failure) => {
  await mount();
  vi.stubGlobal("fetch", failure === "network"
    ? vi.fn().mockRejectedValue(new Error("offline"))
    : vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "删除失败，请稍后重试" }), { status: 500 })));
  await openDelete();
  await act(async () => { confirmDelete().click(); });
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  expect(container.textContent).toContain("正常项目");
  expect(document.querySelector('[role="dialog"] [role="alert"]')?.textContent).toContain(failure === "network" ? "网络异常" : "删除失败");
  expect(confirmDelete().disabled).toBe(false);
});
