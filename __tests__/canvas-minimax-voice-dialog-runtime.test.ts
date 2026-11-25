import * as React from "react";
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CanvasMiniMaxVoiceDialog } from "@/components/canvas/CanvasMiniMaxVoiceDialog";

const mocks = vi.hoisted(() => ({ rename: vi.fn(), remove: vi.fn(), refetch: vi.fn() }));
vi.mock("@/components/canvas/use-canvas-minimax-voices", () => ({
  useCanvasMiniMaxVoiceLibrary: () => ({
    voices: [
      { id: "system", name: "系统音色", source: "system", gender: "unknown", age: "unknown" },
      { id: "mine", name: "我的样本", source: "cloned", gender: "unknown", age: "unknown", canRename: true, canDelete: true },
    ],
    favoriteIds: new Set(), errorMessage: "", setFavorite: vi.fn(),
    renameVoice: mocks.rename, deleteVoice: mocks.remove, refetchVoices: mocks.refetch,
  }),
}));
vi.mock("@/components/canvas/CanvasMiniMaxVoiceCloneDialog", () => ({
  CanvasMiniMaxVoiceCloneDialog: (props: { open: boolean; onCreated: (id: string) => Promise<void> }) => props.open
    ? React.createElement("button", { onClick: () => props.onCreated("mine") }, "模拟克隆成功") : null,
}));

let root: Root;
let host: HTMLDivElement;
const button = (label: string) => Array.from(document.querySelectorAll("button")).find(el => el.textContent === label || el.getAttribute("aria-label") === label)!;
beforeEach(async () => {
  vi.clearAllMocks();
  mocks.rename.mockResolvedValue(undefined);
  mocks.remove.mockResolvedValue(undefined);
  mocks.refetch.mockResolvedValue({ data: { voices: [{ id: "mine" }] } });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(React.createElement(CanvasMiniMaxVoiceDialog, {
    open: true, value: "", model: "speech-2.8-hd", onClose: vi.fn(), onSelect: vi.fn(),
  })));
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function renameDialog() {
  await act(async () => button("我的音色").click());
  await act(async () => button("更多我的样本").click());
  await act(async () => button("修改名称").click());
}
async function inputName(name: string) {
  const input = document.querySelector<HTMLInputElement>('input[aria-label="音色名称"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, name);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
it("closes the clone modal and reveals My Voices after successful creation", async () => {
  await act(async () => button("我的音色").click());
  await act(async () => button("克隆新音色").click());
  await act(async () => button("模拟克隆成功").click());
  expect(button("模拟克隆成功")).toBeUndefined();
  expect(button("我的音色").getAttribute("aria-pressed")).toBe("true");
  expect(document.body.textContent).toContain("我的样本");
  expect(mocks.refetch).toHaveBeenCalledOnce();
});
it("keeps the created ID visible when the refreshed list has not caught up", async () => {
  mocks.refetch.mockResolvedValue({ data: { voices: [] } });
  await act(async () => button("我的音色").click());
  await act(async () => button("克隆新音色").click());
  await act(async () => button("模拟克隆成功").click());
  expect(button("模拟克隆成功")).toBeUndefined();
  expect(document.querySelector(".canvas-minimax-voice-error")?.textContent).toContain("mine");
});
it("saves a trimmed custom name and closes the rename dialog", async () => {
  await renameDialog();
  await inputName("  我的旁白  ");
  await act(async () => button("保存名称").click());
  expect(mocks.rename).toHaveBeenCalledWith("mine", "我的旁白");
  expect(document.querySelector('input[aria-label="音色名称"]')).toBeNull();
});
it("rejects blank names and keeps failed edits available for retry", async () => {
  await renameDialog();
  await inputName("   ");
  expect(button("保存名称").disabled).toBe(true);
  await inputName("新名");
  mocks.rename.mockRejectedValue(new Error("保存失败，请重试"));
  await act(async () => button("保存名称").click());
  expect(document.querySelector('[role="alert"]')?.textContent).toBe("保存失败，请重试");
  expect(document.querySelector<HTMLInputElement>('input[aria-label="音色名称"]')?.value).toBe("新名");
});
it("does not offer renaming for system voices", async () => {
  await act(async () => button("更多系统音色").click());
  expect(button("修改名称")).toBeUndefined();
});

async function deleteDialog() {
  await act(async () => button("我的音色").click());
  await act(async () => button("更多我的样本").click());
  await act(async () => button("删除音色").click());
}
it("asks for confirmation before deleting a custom voice, and allows cancel", async () => {
  await deleteDialog();
  expect(mocks.remove).not.toHaveBeenCalled();
  expect(document.body.textContent).toContain("我的样本");
  await act(async () => button("取消").click());
  expect(mocks.remove).not.toHaveBeenCalled();
  expect(button("确认删除")).toBeUndefined();
});
it("deletes the confirmed voice and closes the confirmation dialog", async () => {
  await deleteDialog();
  await act(async () => button("确认删除").click());
  expect(mocks.remove).toHaveBeenCalledWith("mine");
  expect(button("确认删除")).toBeUndefined();
  expect(document.body.textContent).toContain("音色已删除");
});
it("keeps a failed deletion open for retry", async () => {
  await deleteDialog();
  mocks.remove.mockRejectedValue(new Error("删除失败，请重试"));
  await act(async () => button("确认删除").click());
  expect(document.querySelector('[role="alert"]')?.textContent).toBe("删除失败，请重试");
  expect(button("确认删除")).toBeDefined();
});
it("does not offer deletion for system voices", async () => {
  await act(async () => button("更多系统音色").click());
  expect(button("删除音色")).toBeUndefined();
});
