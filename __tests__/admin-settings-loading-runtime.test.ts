/** @vitest-environment ./__tests__/jsdom-no-canvas-environment.ts */
import * as React from "react";
import { act, Simulate } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminSessionGate } from "@/components/admin/AdminSessionGate";
import UserManagement from "@/components/admin/UserManagement";
import { AdminLoginPanel } from "@/components/settings/admin-login-panel";
import { clearAuthUsersCache } from "@/lib/admin/auth-users-cache";

let host: HTMLDivElement;
let root: Root;
let fetchMock: ReturnType<typeof vi.fn>;
const reply = (data: unknown, ok = true) => ({ ok, json: async () => data });
const accounts = { whitelist: [{ id: 1, name: "保留的账号", createdAt: "2026-09-01" }], users: [] };
const retry = () => [...host.querySelectorAll("button")].find((button) => button.textContent === "重试")!;

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
  clearAuthUsersCache();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "error").mockImplementation(() => {});
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  clearAuthUsersCache();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("settings loading boundaries", () => {
  it("opens the console entry directly for an existing admin session", async () => {
    fetchMock.mockResolvedValue({ status: 200 });
    await act(async () => root.render(React.createElement(AdminLoginPanel, { onClose: vi.fn() })));
    expect(fetchMock).toHaveBeenCalledWith("/api/admin/session", expect.objectContaining({ cache: "no-store" }));
    expect(host.querySelector('a[href="/admin"]')?.textContent).toContain("进入管理控制台");
    expect(host.querySelector("#admin-password")?.closest("[hidden]")).not.toBeNull();
  });

  it("keeps pending and failed login in the dialog without opening a tab", async () => {
    vi.stubGlobal("fetch", (url: string, options?: RequestInit) => url === "/api/admin/session"
      ? Promise.resolve({ status: 401 }) : fetchMock(url, options));
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const onClose = vi.fn();
    let resolve!: (value: unknown) => void;
    fetchMock.mockReturnValue(new Promise((done) => { resolve = done; }));
    await act(async () => root.render(React.createElement(AdminLoginPanel, { onClose })));
    await act(async () => {
      for (const input of host.querySelectorAll("input")) {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "test-credential");
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });
    const visibility = host.querySelector<HTMLButtonElement>('[aria-label="显示密码"]')!;
    await act(async () => visibility.click());
    expect(host.querySelector<HTMLInputElement>('#admin-password')!.type).toBe("text");
    await act(async () => visibility.click());
    expect(host.querySelector<HTMLInputElement>('#admin-password')!.type).toBe("password");
    await act(async () => host.querySelector<HTMLButtonElement>('button[type="submit"]')!.click());
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(open).not.toHaveBeenCalled();
    expect(host.textContent).toContain("正在验证");
    expect(host.querySelector<HTMLButtonElement>('[aria-label="关闭管理员登录"]')!.disabled).toBe(true);
    await act(async () => host.querySelector("dialog")!.dispatchEvent(new Event("cancel", { cancelable: true })));
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => resolve(reply({ error: "密码错误" }, false)));
    expect(open).not.toHaveBeenCalled();
    expect(host.querySelector('[role="alert"]')?.textContent).toBe("密码错误");
    expect(host.querySelector("dialog[open]")).not.toBeNull();
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="关闭管理员登录"]')!.click());
    expect(onClose).toHaveBeenCalledOnce();
  });

  it.each(["success", "blocked", "network"])("handles a new-tab login result: %s", async (result) => {
    const onClose = vi.fn();
    const popup = { opener: window as Window | null };
    vi.stubGlobal("fetch", (url: string, options?: RequestInit) => url === "/api/admin/session"
      ? Promise.resolve({ status: 401 }) : fetchMock(url, options));
    const open = vi.spyOn(window, "open").mockReturnValue(result === "blocked" ? null : popup as unknown as Window);
    if (result === "network") fetchMock.mockRejectedValue(new Error("offline"));
    else fetchMock.mockResolvedValue(reply({ success: true }));
    const originalUrl = window.location.href;
    await act(async () => root.render(React.createElement(AdminLoginPanel, { onClose })));
    await act(async () => {
      for (const input of host.querySelectorAll("input")) {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "test-credential");
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });
    await act(async () => host.querySelector<HTMLButtonElement>('button[type="submit"]')!.click());
    expect(window.location.href).toBe(originalUrl);
    expect(fetchMock).toHaveBeenCalledOnce();
    if (result === "success") {
      expect(open).toHaveBeenCalledWith("/admin", "_blank");
      expect(popup.opener).toBeNull();
      expect(onClose).toHaveBeenCalledOnce();
      expect(host.querySelector<HTMLInputElement>('#admin-password')!.value).toBe("");
    } else if (result === "blocked") {
      expect(open).toHaveBeenCalledWith("/admin", "_blank");
      expect(onClose).not.toHaveBeenCalled();
      expect(host.querySelector('[role="alert"]')).toBeNull();
      expect(host.querySelector<HTMLInputElement>('#admin-password')!.value).toBe("");
      const entry = host.querySelector<HTMLAnchorElement>('a[href="/admin"]')!;
      expect(entry.target).toBe("_blank");
      expect(entry.rel).toBe("noopener noreferrer");
      entry.addEventListener("click", event => event.preventDefault());
      await act(async () => entry.click());
      expect(onClose).toHaveBeenCalledOnce();
      expect(fetchMock).toHaveBeenCalledOnce();
    } else {
      expect(open).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
      expect(host.querySelector('[role="alert"]')).not.toBeNull();
    }
  });

  it("uses the server verified session without another blocking request", async () => {
    await act(async () => root.render(React.createElement(AdminSessionGate, {initialAuthenticated:true,children:"受保护内容"})));
    expect(host.textContent).toContain("受保护内容");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps 10000 accounts paged at 50 rows during repeated browsing", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('view=summary')) return reply({accounts:10000,registered:0});
      const page=Number(new URL(url,'http://localhost').searchParams.get('page'));
      return reply({whitelist:Array.from({length:50},(_,i)=>({id:page*50+i,name:`Account-${page}-${i}`,createdAt:'2026-09-01'})),users:[],pagination:{page,pageSize:50,total:10000,hasMore:page<200}});
    });
    await act(async()=>root.render(React.createElement(UserManagement)));
    for(let page=1;page<=12;page++) {
      expect(host.textContent).toContain(`Account-${page}-0`);
      expect((host.textContent?.match(/Account-/g)||[])).toHaveLength(50);
      expect(host.textContent).toContain('共 10000 人');
      if(page<12) await act(async()=>[...host.querySelectorAll('button')].find(b=>b.textContent==='下一页')!.click());
    }
    await act(async()=>[...host.querySelectorAll('button')].find(b=>b.textContent==='上一页')!.click());
    expect(host.textContent).toContain('Account-11-0');
    expect((host.textContent?.match(/Account-/g)||[])).toHaveLength(50);
  });

  it("aborts old account searches and ignores their late results", async () => {
    const pending: Array<{resolve:(value:unknown)=>void;signal:AbortSignal}> = [];
    fetchMock.mockImplementation((url: string, options: RequestInit) => {
      if(url.includes('view=summary')) return Promise.resolve(reply({accounts:10000}));
      return new Promise(resolve=>pending.push({resolve,signal:options.signal as AbortSignal}));
    });
    await act(async()=>root.render(React.createElement<{refreshSignal?:number}>(UserManagement,{refreshSignal:0})));
    await act(async()=>root.render(React.createElement<{refreshSignal?:number}>(UserManagement,{refreshSignal:1})));
    expect(pending[0].signal.aborted).toBe(true);
    await act(async()=>pending[1].resolve(reply(accounts)));
    await act(async()=>pending[0].resolve(reply({whitelist:[{id:2,name:'过期结果',createdAt:''}],users:[]})));
    expect(host.textContent).toContain('保留的账号');
    expect(host.textContent).not.toContain('过期结果');
  });

  it("keeps unauthenticated 401 responses on the login redirect path, not the retry path", async () => {
    fetchMock.mockResolvedValue(reply({ authenticated: false }, false));
    await act(async () => root.render(React.createElement(AdminSessionGate, null, "受保护内容")));
    expect(host.textContent).not.toContain("受保护内容");
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(host.textContent).not.toContain("重试");
  });
  it("shows session feedback without mounting protected content, then recovers from failure", async () => {
    let resolve!: (value: unknown) => void;
    fetchMock.mockReturnValueOnce(new Promise((done) => { resolve = done; }))
      .mockResolvedValueOnce(reply({ authenticated: true }));
    const mounted = vi.fn();
    function Protected() { React.useEffect(mounted, []); return React.createElement("p", null, "受保护内容"); }
    await act(async () => root.render(React.createElement(AdminSessionGate, null, React.createElement(Protected))));
    expect(host.querySelector('[role="status"][aria-label="正在加载系统概览"]')).not.toBeNull();
    expect(mounted).not.toHaveBeenCalled();
    await act(async () => resolve(reply({}, false)));
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
    expect(mounted).not.toHaveBeenCalled();
    await act(async () => retry().click());
    expect(host.textContent).toContain("受保护内容");
    expect(mounted).toHaveBeenCalledOnce();
  });

  it("retains account structure while pending and retries an initial failure without fake zero counts", async () => {
    let reject!: (error: Error) => void;
    fetchMock.mockReturnValueOnce(new Promise((_, fail) => { reject = fail; }))
      .mockResolvedValueOnce(reply(accounts));
    await act(async () => root.render(React.createElement(UserManagement)));
    expect(host.textContent).toContain("用户列表");
    expect(host.textContent).toContain("正在加载账号信息");
    expect(host.textContent).not.toContain("共 0 人");
    expect(host.querySelector("input")?.disabled).toBe(true);
    await act(async () => reject(new Error("网络中断")));
    expect(host.textContent).toContain("账号信息加载失败");
    expect(host.textContent).not.toContain("共 0 人");
    await act(async () => retry().click());
    expect(host.textContent).toContain("保留的账号");
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });

  it("preserves loaded rows and unsaved input when a background refresh fails", async () => {
    fetchMock.mockResolvedValueOnce(reply(accounts)).mockRejectedValueOnce(new Error("网络中断"));
    await act(async () => root.render(React.createElement<{ refreshSignal?: number }>(UserManagement, { refreshSignal: 0 })));
    const input = host.querySelector('input[placeholder="输入用户名，多个用逗号或换行分隔"]') as HTMLInputElement;
    expect(input).not.toBeNull();
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "未保存草稿");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => root.render(React.createElement<{ refreshSignal?: number }>(UserManagement, { refreshSignal: 1 })));
    expect(host.textContent).toContain("保留的账号");
    expect(host.textContent).toContain("刷新失败");
    expect(input.value).toBe("未保存草稿");
  });

  it("retains loaded accounts on tab return while clearing revealed credentials when hidden", async () => {
    fetchMock.mockImplementation(async (_url: string, options?: RequestInit) => reply(options?.method === "POST"
      ? { password: "synthetic-visible-secret" }
      : { whitelist: [], users: [{ id: 1, username: "保留的账号", createdAt: "2026-09-01", generationCount: 0 }] }));
    await act(async () => root.render(React.createElement<{ active?: boolean }>(UserManagement, { active: true })));
    const accountFetchCount = fetchMock.mock.calls.length;
    await act(async () => host.querySelector<HTMLButtonElement>('button[title="输入管理员密码后查看密码"]')!.click());
    const passwordInput = document.querySelector<HTMLInputElement>('input[placeholder="请输入管理员密码"]')!;
    await act(async () => Simulate.change(passwordInput, { target: { value: "synthetic-admin-secret" } } as any));
    await act(async () => [...document.querySelectorAll("button")].find((button) => button.textContent?.trim() === "确认查看")!.click());
    expect(host.textContent).toContain("synthetic-visible-secret");
    await act(async () => root.render(React.createElement<{ active?: boolean }>(UserManagement, { active: false })));
    expect(host.textContent).not.toContain("synthetic-visible-secret");
    await act(async () => root.render(React.createElement<{ active?: boolean }>(UserManagement, { active: true })));
    expect(host.textContent).toContain("保留的账号");
    expect(host.textContent).not.toContain("synthetic-visible-secret");
    expect(fetchMock.mock.calls.filter(([, options]) => options?.method !== "POST")).toHaveLength(accountFetchCount);
  });

  it("refreshes invalidated account data in place after returning from another admin tab", async () => {
    fetchMock.mockResolvedValueOnce(reply(accounts));
    await act(async () => root.render(React.createElement<{ active?: boolean }>(UserManagement, { active: true })));
    await act(async () => root.render(React.createElement<{ active?: boolean }>(UserManagement, { active: false })));
    clearAuthUsersCache();
    let finish!: (value: unknown) => void;
    fetchMock.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    await act(async () => root.render(React.createElement<{ active?: boolean }>(UserManagement, { active: true })));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(host.textContent).toContain("保留的账号");
    expect(host.textContent).not.toContain("正在加载账号信息");
    await act(async () => finish(reply({ whitelist: [], users: [] })));
    expect(host.textContent).not.toContain("保留的账号");
  });

  it("does not replace cached accounts with a malformed response", async () => {
    fetchMock.mockResolvedValueOnce(reply(accounts)).mockResolvedValueOnce(reply({}));
    await act(async () => root.render(React.createElement<{ refreshSignal?: number }>(UserManagement, { refreshSignal: 0 })));
    await act(async () => root.render(React.createElement<{ refreshSignal?: number }>(UserManagement, { refreshSignal: 1 })));
    expect(host.textContent).toContain("保留的账号");
    expect(host.textContent).toContain("账号数据不完整");
  });
});
