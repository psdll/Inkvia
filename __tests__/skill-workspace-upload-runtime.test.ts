import * as React from "react";
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SystemSkillContentWorkspace } from "@/components/role-skills/system-skill-content-workspace";
import { createDefaultSkillWorkspace } from "@/lib/role-skills/skill-workspace";

vi.mock("@/components/role-skills/skill-markdown-editor", () => ({ SkillMarkdownEditor: () => null }));
let root: Root;
let host: HTMLDivElement;
const click = async (text: string) => {
  const button = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((node) => node.textContent === text)!;
  await act(async () => button.click());
};
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

async function upload(content: string | Uint8Array, folder = true, name = "LICENSE") {
  const onChange = vi.fn();
  await act(async () => root.render(React.createElement(SystemSkillContentWorkspace, {
    value: createDefaultSkillWorkspace(), onChange,
  })));
  await click("上传");
  await click(folder ? "上传文件夹" : "上传文件");
  await click("根目录");
  await click("下一步");
  const files = [
    { name, webkitRelativePath: `workflow/${name}`, type: "", text: async () => content },
    { name: "SKILL.md", webkitRelativePath: "workflow/SKILL.md", type: "", text: async () => "# Workflow" },
    { name: "guide.md", webkitRelativePath: "workflow/references/guide.md", type: "", text: async () => "中文参考" },
  ];
  const input = document.querySelector<HTMLInputElement>(folder ? "input[webkitdirectory]" : 'input[type="file"]:not([webkitdirectory])')!;
  Object.defineProperty(input, "files", { configurable: true, value: (folder ? files : files.slice(0, 1)).map((file) => ({
    ...file, arrayBuffer: async () => {
      const text = await file.text();
      return typeof text === "string" ? new TextEncoder().encode(text).buffer : text.buffer;
    },
  })) });
  await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
  return onChange;
}

it("imports an extracted Skill folder including extensionless LICENSE and nested references", async () => {
  const onChange = await upload("MIT License\nCopyright");
  expect(document.querySelector('[role="alert"]')).toBeNull();
  expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
    directories: ["workflow", "workflow/references"],
    files: expect.arrayContaining([
      { path: "workflow/LICENSE", content: "MIT License\nCopyright" },
      { path: "workflow/SKILL.md", content: "# Workflow" },
      { path: "workflow/references/guide.md", content: "中文参考" },
    ]),
  }));
});

it("still rejects binary content disguised as an extensionless file without partially importing", async () => {
  const onChange = await upload("binary\u0000data");
  expect(onChange).not.toHaveBeenCalled();
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("不是可读取文本");
});

it.each(["LICENSE", "README", "settings.conf", ".env.example"])("uploads a standalone plain-text file %s", async (name) => {
  const onChange = await upload("纯文本内容\nkey=value", false, name);
  expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
    files: expect.arrayContaining([{ path: name, content: "纯文本内容\nkey=value" }]),
  }));
});

it("rejects invalid text bytes even when the filename is Markdown", async () => {
  const onChange = await upload(new Uint8Array([0xff, 0xfe, 0xfd]), false, "binary.md");
  expect(onChange).not.toHaveBeenCalled();
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("不是可读取文本");
});
