import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { act, Simulate } from "react-dom/test-utils";
import { describe, expect, it, vi } from "vitest";
import AdminConfirmModal from "@/components/admin/AdminConfirmModal";
import { DesktopModeProvider } from "@/components/system/desktop-mode";
import { UiLocaleProvider } from "@/i18n/ui";
import english from "@/messages/en.json";
import chinese from "@/messages/zh-CN.json";

describe("localized storage cleanup challenge", () => {
  it.each([
    ["en", true, "Delete old local works", "This permanently deletes expired works on this device"],
    ["en", false, "Delete old works for all users", "For all users, it deletes old work records"],
    ["zh-CN", true, "删除本机旧任务作品", "将删除超期的本机任务作品"],
    ["zh-CN", false, "删除全站用户旧任务作品", "它会删除全站用户的旧任务作品记录"],
  ] as const)("%s desktop=%s keeps the password, typed challenge and second confirmation", async (locale, desktop, phrase, description) => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const confirm = vi.fn();
    try {
      await act(async () => root.render(createElement(UiLocaleProvider, {
        locale,
        messages: locale === "en" ? english : chinese,
        children: createElement(DesktopModeProvider, {
          value: desktop,
          children: createElement(AdminConfirmModal, {
            action: { type: "cleanup_storage", action: "cleanup_old_uploads", title: "cleanup" },
            busy: false,
            onCancel: vi.fn(),
            onConfirm: confirm,
          }),
        }),
      })));
      const challenge = host.querySelector<HTMLInputElement>('input[type="text"]')!;
      const password = host.querySelector<HTMLInputElement>('input[type="password"]')!;
      const submit = host.querySelectorAll("button")[1];
      expect(host.textContent).toContain(description);
      expect(challenge.placeholder).toBe(phrase);
      expect(submit.disabled).toBe(true);

      const type = async (input: HTMLInputElement, value: string) => {
        await act(async () => { input.value = value; Simulate.change(input); });
      };
      await type(challenge, phrase);
      expect(submit.disabled).toBe(true);
      await type(password, " local test password ");
      await type(challenge, "wrong phrase");
      expect(submit.disabled).toBe(true);
      await type(challenge, phrase);
      await act(async () => submit.click());
      expect(confirm).not.toHaveBeenCalled();
      await act(async () => submit.click());
      expect(confirm).toHaveBeenCalledTimes(1);
      expect(confirm).toHaveBeenCalledWith("local test password");
    } finally {
      await act(async () => root.unmount());
      host.remove();
      vi.unstubAllGlobals();
    }
  });
});
