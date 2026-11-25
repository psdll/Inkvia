import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { act, Simulate } from "react-dom/test-utils";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import LoginModal from "@/components/auth/LoginModal";

const auth = vi.hoisted(() => ({
  user: null, showLoginModal: true, loginNotice: null,
  closeLoginModal: vi.fn(), login: vi.fn(), register: vi.fn(),
  resetPassword: vi.fn(async () => ({ success: true })),
}));
vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => auth }));
Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });
let root: Root;
let container: HTMLDivElement;
beforeEach(async () => {
  vi.clearAllMocks();
  container = document.createElement("div"); document.body.appendChild(container);
  root = createRoot(container);
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ allowed: true })));
  await act(async () => root.render(React.createElement(LoginModal)));
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove(); vi.unstubAllGlobals();
});
async function enter(selector: string, value: string) {
  await act(async () => Simulate.change(container.querySelector<HTMLInputElement>(selector)!, { target: { value } } as any));
}
async function forgotPassword() {
  await enter("#account-username", "synthetic-user");
  const button = Array.from(container.querySelectorAll("button")).find(item => item.textContent === "忘记密码？")!;
  await act(async () => button.click());
}
it("submits only username and new password after administrator permission", async () => {
  await forgotPassword();
  expect(container.textContent).toContain("管理员已允许自助重置");
  expect(container.textContent).not.toContain("凭证");
  expect(container.querySelectorAll("input")).toHaveLength(3);
  await enter("#account-password", "new-password");
  await enter("#account-confirm-password", "new-password");
  await act(async () => Simulate.submit(container.querySelector("form")!));
  expect(auth.resetPassword).toHaveBeenCalledTimes(1);
  expect(auth.resetPassword).toHaveBeenCalledWith("synthetic-user", "new-password");
});
it("keeps the reset form closed when the administrator has not allowed it", async () => {
  vi.mocked(fetch).mockResolvedValue(Response.json({ allowed: false }));
  await forgotPassword();
  expect(container.textContent).toContain("管理员尚未开启该账号的自助重置");
  expect(container.querySelector("#account-confirm-password")).toBeNull();
  expect(auth.resetPassword).not.toHaveBeenCalled();
});
