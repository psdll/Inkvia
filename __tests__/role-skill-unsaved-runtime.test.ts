/** @vitest-environment ./__tests__/jsdom-no-canvas-environment.ts */
import * as React from "react";
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const clients = vi.hoisted(() => ({ create: vi.fn(), update: vi.fn(), get: vi.fn(), skillId: "" }));
vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => ({ user: null }) }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(clients.skillId ? `skillId=${clients.skillId}` : "") }));
vi.mock("@/lib/role-skills/client", () => ({
  listSystemRoleSkillsAdmin: async () => [], createSystemRoleSkillAdmin: clients.create, updateSystemRoleSkillAdmin: clients.update, getSystemRoleSkillAdmin: clients.get,
  uploadPersonalRoleSkillCover: vi.fn(), uploadSystemRoleSkillCover: vi.fn(), deletePersonalRoleSkillCoverClient: vi.fn(), deleteSystemRoleSkillCoverClient: vi.fn(),
}));
vi.mock("@/components/ui/frosted-select", () => ({ FrostedSelect: ({ value, options, onChange, ariaLabel, disabled }: any) => React.createElement("select", { value, disabled, "aria-label": ariaLabel || "发布状态", onChange: (e: any) => onChange(e.target.value) }, options.map((o: any) => React.createElement("option", { key: o.value, value: o.value }, o.label))) }));
vi.mock("@/components/ui/suggest-select", () => ({ SuggestSelect: ({ value, onChange }: any) => React.createElement("input", { value, onChange: (e: any) => onChange(e.target.value) }) }));
vi.mock("@/components/role-skills/skill-markdown-editor", () => ({ SkillMarkdownEditor: () => null }));
vi.mock("@/hooks/use-role-skill-catalog", () => ({ useRoleSkillCatalog: () => ({ skills: [], loading: false, error: null, refresh: vi.fn() }) }));
vi.mock("@/components/role-skills/system-skill-content-workspace", () => ({ SystemSkillContentWorkspace: ({ value, onChange }: any) => React.createElement("textarea", { "aria-label": "技能内容", value: value.files[0].content, onChange: (e: any) => onChange({ ...value, files: value.files.map((f: any, i: number) => i === 0 ? { ...f, content: e.target.value } : f) }) }) }));
import { SystemRoleSkillEditorPage } from "@/components/admin/SystemRoleSkillEditorPage";
import { RoleSkillEditor } from "@/components/role-skills/role-skill-editor";
import { RoleSkillDialog } from "@/components/role-skills/role-skill-dialog";
import { useUnsavedChanges } from "@/hooks/use-unsaved-changes";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { createDefaultSkillWorkspace } from "@/lib/role-skills/skill-workspace";
let root: Root; let host: HTMLDivElement; let close: ReturnType<typeof vi.spyOn>;
const saved = { id: "skill-test", name: "测试技能", summary: "说明", category: "通用技能", content: "内容", usageScenario: "场景", usageGuide: "方法", coverUrl: "/uploads/role_skill_covers/system/cover.webp", workspace: createDefaultSkillWorkspace("内容"), status: "hidden", mediaType: "image", featureKeys: [], revision: 1 };
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.useFakeTimers();
  clients.skillId = ""; clients.get.mockReset().mockResolvedValue(saved); clients.create.mockReset().mockResolvedValue(saved); clients.update.mockReset().mockResolvedValue({ ...saved, revision: 2 });
  close = vi.spyOn(window, "close").mockImplementation(() => undefined);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ""; vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const button = (label: string) => Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.trim() === label || b.getAttribute("aria-label") === label)!;
async function input(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  await act(async () => { Object.getOwnPropertyDescriptor(element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, "value")!.set!.call(element, value); element.dispatchEvent(new Event("input", { bubbles: true })); });
}
async function select(label: string, value: string) {
  await act(async () => { const el = document.querySelector(`select[aria-label="${label}"]`) as HTMLSelectElement; el.value = value; el.dispatchEvent(new Event("change", { bubbles: true })); });
}
async function selectMediaType(value: string) {
  const radio = host.querySelector<HTMLInputElement>(`input[type="radio"][value="${value}"]`);
  expect(radio).not.toBeNull();
  await act(async () => radio!.click());
}
function unloadPrevented() { const event = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; }

describe("skill editing leave protection", () => {
  it.each(["personal-create", "personal-edit", "system-admin"] as const)("saves %s with or without a cover image", async (mode) => {
    const onSave = vi.fn(async (_value: unknown) => undefined);
    await act(async () => root.render(React.createElement(RoleSkillEditor, { mode, initialValue: { ...saved, coverUrl: null } as any, categoryOptions: ["通用技能"], onSave, onCancel: vi.fn() })));
    await act(async () => button("保存技能").click());
    expect(host.textContent).not.toContain("请上传技能封面图片");
    expect(onSave).toHaveBeenCalledOnce();
    expect(onSave.mock.calls[0][0]).toMatchObject({ coverUrl: null });
    await act(async () => root.render(React.createElement(RoleSkillEditor, { mode, initialValue: saved as any, categoryOptions: ["通用技能"], onSave, onCancel: vi.fn() })));
    await act(async () => button("保存技能").click());
    expect(onSave).toHaveBeenCalledTimes(2);
    expect(onSave.mock.calls[1][0]).toMatchObject({ coverUrl: saved.coverUrl });
    await act(async () => button("移除封面").click());
    await act(async () => button("保存技能").click());
    expect(onSave).toHaveBeenCalledTimes(3);
    expect(onSave.mock.calls[2][0]).toMatchObject({ coverUrl: null });
  });
  it("closes the library only when pointer down starts on its backdrop", async () => {
    const closePanel = vi.fn();
    await act(async () => root.render(React.createElement(RoleSkillDialog, { open: true, authUserId: "test", selectedRoleSkillId: null, resultRoleSkillId: null, legacySystemPrompt: "", result: null, generating: false, onClose: closePanel, onSelect: vi.fn(), onGenerate: vi.fn(), onApplyResult: vi.fn() })));
    const panel = document.querySelector('[role="dialog"]')!;
    const backdrop = panel.parentElement!;
    await act(async () => panel.dispatchEvent(new MouseEvent("pointerdown", { button: 0, bubbles: true })));
    await act(async () => backdrop.dispatchEvent(new MouseEvent("pointerdown", { button: 2, bubbles: true })));
    expect(closePanel).not.toHaveBeenCalled();
    await act(async () => backdrop.dispatchEvent(new MouseEvent("pointerdown", { button: 0, bubbles: true })));
    expect(closePanel).toHaveBeenCalledTimes(1);
  });
  it.each(["close", "cancel", "escape", "discard"])("closes a directly opened creator without showing the library: %s", async (action) => {
    function Harness() {
      const [open, setOpen] = React.useState(true);
      return React.createElement(RoleSkillDialog, { open, initialView: "create", purpose: "agent", authUserId: "test", selectedRoleSkillId: null, resultRoleSkillId: null, legacySystemPrompt: "", result: null, generating: false, onClose: () => setOpen(false), onSelect: vi.fn(), onGenerate: vi.fn(), onApplyResult: vi.fn() });
    }
    await act(async () => root.render(React.createElement(Harness)));
    const name = document.querySelector('input[placeholder="例如：商品棚拍精修"]') as HTMLInputElement;
    expect(name).not.toBeNull();
    if (action === "discard") {
      await input(name, "直接创建草稿");
      await act(async () => button("取消").click());
      await act(async () => button("继续编辑").click());
      expect(name.value).toBe("直接创建草稿");
      await act(async () => button("取消").click());
      await act(async () => button("放弃修改并离开").click());
    } else if (action === "escape") {
      await act(async () => name.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
    } else {
      await act(async () => (action === "close" ? document.querySelector('[aria-label="关闭编辑器"]') as HTMLButtonElement : button("取消")).click());
    }
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(button("创建技能")).toBeUndefined();
    expect(unloadPrevented()).toBe(false);
  });
  it("guards Escape in the actual personal skill panel without closing the panel behind confirmation", async () => {
    const closePanel = vi.fn();
    await act(async () => root.render(React.createElement(RoleSkillDialog, { open: true, authUserId: "test", selectedRoleSkillId: null, resultRoleSkillId: null, legacySystemPrompt: "", result: null, generating: false, onClose: closePanel, onSelect: vi.fn(), onGenerate: vi.fn(), onApplyResult: vi.fn() })));
    await act(async () => button("创建技能").click());
    const name = document.querySelector('input[placeholder="例如：商品棚拍精修"]') as HTMLInputElement;
    await input(name, "个人技能草稿");
    await act(async () => name.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(2);
    await act(async () => document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1); expect(name.value).toBe("个人技能草稿"); expect(closePanel).not.toHaveBeenCalled();
    await act(async () => button("取消").click());
    await act(async () => button("放弃修改并离开").click());
    expect(button("创建技能")).toBeDefined(); expect(unloadPrevented()).toBe(false); expect(closePanel).not.toHaveBeenCalled();
  });
  it("leaves a clean page directly, without prompting on initial editor hydration", async () => {
    await act(async () => root.render(React.createElement(SystemRoleSkillEditorPage)));
    expect(unloadPrevented()).toBe(false);
    await act(async () => button("取消").click());
    expect(close).toHaveBeenCalledTimes(1); expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
  it("keeps edited content on continue, intercepts refresh, and discards only after confirmation", async () => {
    await act(async () => root.render(React.createElement(SystemRoleSkillEditorPage)));
    const name = host.querySelector('input[placeholder="例如：商品棚拍精修"]') as HTMLInputElement;
    await input(name, "未保存技能"); expect(unloadPrevented()).toBe(true);
    await act(async () => button("取消").click());
    expect(close).not.toHaveBeenCalled(); expect(document.activeElement).toBe(button("继续编辑"));
    await act(async () => button("继续编辑").click()); expect(name.value).toBe("未保存技能");
    await act(async () => (host.querySelector('[aria-label="关闭系统 Skill 页面"]') as HTMLButtonElement).click());
    await act(async () => button("放弃修改并离开").click());
    expect(close).toHaveBeenCalledTimes(1); expect(unloadPrevented()).toBe(false);
  });
  it("tracks publication settings and does not warn after reverting to their saved values", async () => {
    clients.skillId = "skill-test";
    await act(async () => root.render(React.createElement(SystemRoleSkillEditorPage)));
    expect(unloadPrevented()).toBe(false);
    await select("发布状态", "published"); expect(unloadPrevented()).toBe(true);
    await select("发布状态", "hidden"); expect(unloadPrevented()).toBe(false);
    await selectMediaType("video"); expect(unloadPrevented()).toBe(true);
    await selectMediaType("image"); expect(unloadPrevented()).toBe(false);
  });
  it("retains dirty state after a save error and clears it only after successful save", async () => {
    clients.skillId = "skill-test"; clients.update.mockRejectedValueOnce(new Error("保存失败"));
    await act(async () => root.render(React.createElement(SystemRoleSkillEditorPage)));
    await input(host.querySelector('input[placeholder="例如：商品棚拍精修"]') as HTMLInputElement, "修改的技能");
    await act(async () => button("保存技能").click());
    expect(host.textContent).toContain("保存失败"); expect(unloadPrevented()).toBe(true);
    await act(async () => button("保存技能").click());
    expect(clients.update).toHaveBeenCalledTimes(2); expect(unloadPrevented()).toBe(false);
    await act(async () => button("取消").click()); expect(close).toHaveBeenCalledTimes(1);
  });
  it("blocks leaving while save is pending", async () => {
    clients.skillId = "skill-test"; let finish!: (value: unknown) => void; clients.update.mockReturnValue(new Promise((done) => { finish = done; }));
    await act(async () => root.render(React.createElement(SystemRoleSkillEditorPage)));
    await act(async () => button("保存技能").click());
    expect(button("取消").disabled).toBe(true); expect((host.querySelector('[aria-label="关闭系统 Skill 页面"]') as HTMLButtonElement).disabled).toBe(true); expect(unloadPrevented()).toBe(true);
    await act(async () => finish({ ...saved, revision: 2 })); expect(unloadPrevented()).toBe(false);
  });
  it("tracks a personal editor's content changes and protects its cancel action", async () => {
    const leaveEditor = vi.fn();
    function Harness() {
      const [dirty, setDirty] = React.useState(false); const leave = useUnsavedChanges(dirty);
      return React.createElement(React.Fragment, null,
        React.createElement(RoleSkillEditor, { mode: "personal-edit", initialValue: saved as any, categoryOptions: ["通用技能"], onSave: vi.fn(), onDirtyChange: setDirty, onCancel: () => leave.requestLeave(leaveEditor) }),
        React.createElement(ConfirmDialog, { open: leave.confirmOpen, title: "离开编辑", cancelText: "继续编辑", confirmText: "放弃", danger: true, onConfirm: leave.discardAndLeave, onClose: leave.cancelLeave }));
    }
    await act(async () => root.render(React.createElement(Harness)));
    await input(host.querySelector('[aria-label="技能内容"]') as HTMLTextAreaElement, "更新后的内容");
    await act(async () => button("取消").click()); expect(leaveEditor).not.toHaveBeenCalled();
    await act(async () => button("放弃").click()); expect(leaveEditor).toHaveBeenCalledTimes(1);
  });
});
