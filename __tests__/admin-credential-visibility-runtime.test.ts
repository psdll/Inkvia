import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { act, Simulate } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import UserManagement from "@/components/admin/UserManagement";
import { clearAuthUsersCache, getAuthUsersCache, setAuthUsersCache } from "@/lib/admin/auth-users-cache";

vi.mock("@/lib/client/inflight-json", () => ({ fetchJsonOnce: vi.fn(async () => ({ ok: true, json: { accounts: 1 } })) }));
Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });
let root: Root;
let container: HTMLDivElement;
const flush = async () => { await act(async () => { await Promise.resolve(); }); };
async function click(selector: string) {
  const button = document.querySelector<HTMLButtonElement>(selector);
  expect(button).toBeTruthy();
  await act(async () => { button!.click(); });
}
async function beginReveal() {
  await click('button[title="输入管理员密码后查看密码"]');
  const input = document.querySelector<HTMLInputElement>('input[placeholder="请输入管理员密码"]')!;
  await act(async () => { Simulate.change(input, { target: { value: "synthetic-admin-password" } } as any); });
  const button = Array.from(document.querySelectorAll("button")).find(item => item.textContent?.trim() === "确认查看")!;
  await act(async () => { button.click(); });
}
beforeEach(async () => {
  clearAuthUsersCache();
  container = document.createElement("div"); document.body.appendChild(container);
  root = createRoot(container);
  vi.stubGlobal("fetch", vi.fn(async (url: string) => Response.json(url.startsWith("/api/admin/auth-users?view=page")
    ? { whitelist: [], users: [{ id: 1, username: "synthetic-user", createdAt: "2026-09-06T00:00:00Z", generationCount: 0 }], pagination: { page: 1, total: 1, pageSize: 50, totalPages: 1 } }
    : { password: "synthetic-current-password" })));
  await act(async () => { root.render(React.createElement(UserManagement)); });
  await flush();
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove(); clearAuthUsersCache(); vi.unstubAllGlobals();
});
describe("administrator credential visibility", () => {
  it("reveals after confirmation and removes the secret on hide and logout", async () => {
    await beginReveal(); await flush();
    expect(container.textContent).toContain("synthetic-current-password");
    expect(JSON.stringify(getAuthUsersCache())).not.toContain("synthetic-current-password");
    await click('button[title="隐藏密码"]');
    expect(container.textContent).not.toContain("synthetic-current-password");
    await beginReveal(); await flush();
    await act(async () => { window.dispatchEvent(new Event("inkvia:admin-session-ended")); });
    expect(container.textContent).not.toContain("synthetic-current-password");
  });
  it("discards a reveal response arriving after logout", async () => {
    let finish!: (response: Response) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(resolve => { finish = resolve; })));
    await beginReveal();
    await act(async () => { window.dispatchEvent(new Event("inkvia:admin-session-ended")); });
    await act(async () => { finish(new Response(JSON.stringify({ password: "late-secret" }))); });
    expect(container.textContent).not.toContain("late-secret");
  });
  it("removes a revealed password when changing the visible account filter", async () => {
    await beginReveal(); await flush();
    const input = document.querySelector<HTMLInputElement>('input[placeholder="搜索用户名..."]')!;
    await act(async () => { Simulate.change(input, { target: { value: "synthetic" } } as any); });
    expect(container.textContent).not.toContain("synthetic-current-password");
  });
  it("whitelists cache fields even when a response contains credentials", () => {
    setAuthUsersCache({ whitelist: [], users: [{ id: 1, username: "synthetic", password: "plain", passwordCipher: { ciphertext: "cipher" }, token: "session", credentialVersion: 2, resetToken: "grant", createdAt: "now", generationCount: 0 } as any] });
    expect(Object.keys(getAuthUsersCache()!.users[0])).not.toEqual(expect.arrayContaining(["password"]));
    expect(JSON.stringify(getAuthUsersCache())).not.toMatch(/password|Cipher|token|credential|grant/);
  });
});
