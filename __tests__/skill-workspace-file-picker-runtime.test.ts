import * as React from "react";
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SkillWorkspaceFilePicker } from "@/components/role-skills/skill-workspace-file-picker";

let root: Root;
let host: HTMLDivElement;
const workspace = {
  primaryPath: "SKILL.md",
  directories: ["empty"],
  files: [
    { path: "SKILL.md", content: "Main" },
    { path: "references/methods/guide.md", content: "Nested" },
    { path: "references/guide.md", content: "Parent" },
  ],
};
const button = (name: string) => document.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`)!;
const click = async (name: string) => { await act(async () => button(name).click()); };

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

it("expands folder rows and selects the exact nested path without selecting folders", async () => {
  const onChange = vi.fn();
  await act(async () => root.render(React.createElement(SkillWorkspaceFilePicker, { workspace, value: "SKILL.md", onChange })));
  await click("选择 Skill 文件");
  expect(button("empty")).not.toBeNull();
  expect(button("references/guide.md")).toBeNull();
  await click("references");
  expect(button("references/guide.md")).not.toBeNull();
  await click("references/methods");
  expect(button("references/methods/guide.md")).not.toBeNull();
  await click("references");
  expect(button("references/methods/guide.md")).toBeNull();
  expect(onChange).not.toHaveBeenCalled();
  await click("references");
  await click("references/methods/guide.md");
  expect(onChange).toHaveBeenCalledWith("references/methods/guide.md");
  expect(document.querySelector('[aria-label="Skill 文件目录"]')).toBeNull();
});

it("reveals the selected file's parents and dismisses only the picker with Escape", async () => {
  await act(async () => root.render(React.createElement(SkillWorkspaceFilePicker, { workspace, value: "references/methods/guide.md", onChange: vi.fn() })));
  await click("选择 Skill 文件");
  expect(button("references").getAttribute("aria-expanded")).toBe("true");
  expect(button("references/methods").getAttribute("aria-expanded")).toBe("true");
  expect(document.activeElement).toBe(button("references/methods/guide.md"));
  const outerEscape = vi.fn();
  window.addEventListener("keydown", outerEscape);
  await act(async () => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); });
  expect(outerEscape).not.toHaveBeenCalled();
  expect(document.querySelector('[aria-label="Skill 文件目录"]')).toBeNull();
  expect(document.activeElement).toBe(button("选择 Skill 文件"));
  window.removeEventListener("keydown", outerEscape);
});
