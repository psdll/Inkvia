// @vitest-environment jsdom
import * as React from "react";
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import QuestionForm from "@/components/creative-agent/QuestionForm";
import type { QuestionField } from "@/lib/creative-agent/questions";

const fields: QuestionField[] = [
  { id: "model", title: "图片模型", type: "radio", required: true, options: [{ value: "gpt", label: "GPT Image", recommended: true, description: "依据当前任务选择" }, { value: "seedream", label: "Seedream" }] },
  { id: "scope", title: "生成范围", type: "radio", required: true, options: [{ value: "people", label: "只做角色" }, { value: "all", label: "角色和场景" }] },
  { id: "appearance", title: "外观调整", type: "text" },
];
let host: HTMLDivElement, root: Root;
const onAnswer = vi.fn(async () => true);
const render = async (disabled = false) => { await act(async () => root.render(React.createElement(QuestionForm, { id: "decision", proposalHash: "hash", fields, disabled, onAnswer }))); };
const click = async (selector: string) => { await act(async () => (host.querySelector(selector) as HTMLElement).click()); };
const fill = async (selector: string, value: string) => {
  await act(async () => {
    const input = host.querySelector(selector) as HTMLInputElement;
    Object.getOwnPropertyDescriptor(input.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
};
beforeEach(() => {
  vi.clearAllMocks(); sessionStorage.clear(); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  onAnswer.mockResolvedValue(true);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

it("shows one question at a time, validates each page and submits the complete answer only at the end", async () => {
  await render();
  expect(host.querySelector("input:checked")).toBeNull();
  expect(host.textContent).toContain("1/3");
  expect(host.textContent).not.toContain("生成范围");
  await click('button[type="submit"]');
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("图片模型");
  expect(onAnswer).not.toHaveBeenCalled();
  await click('input[value="gpt"]'); await click('button[type="submit"]');
  expect(host.textContent).toContain("2/3");
  await click('input[value="people"]'); await click('button[type="submit"]');
  expect(onAnswer).not.toHaveBeenCalled();
  await fill('[aria-label="外观调整"]', "补丁改成米色");
  await fill('[aria-label="补充说明"]', "先做两张角色，场景之后再说");
  await click('button[type="submit"]');
  expect(onAnswer).toHaveBeenCalledWith({ values: { model: "gpt", scope: "people", appearance: "补丁改成米色" }, notes: { appearance: "先做两张角色，场景之后再说" } });
  expect(sessionStorage.getItem("creative-agent-question:decision:hash")).toBeNull();
});
it("keeps a custom answer for each question across navigation, remount and submission without selecting options", async () => {
  await render();
  await fill('[aria-label="补充说明"]', "先不生成，整理提示词");
  await click('button[type="submit"]');
  expect(host.textContent).toContain("2/3");
  expect((host.querySelector('[aria-label="补充说明"]') as HTMLTextAreaElement).value).toBe("");
  await fill('[aria-label="补充说明"]', "角色和场景已经在画布上了");
  await click('button[type="submit"]');
  expect(host.textContent).toContain("3/3");
  expect((host.querySelector('[aria-label="补充说明"]') as HTMLTextAreaElement).value).toBe("");
  await act(async () => root.unmount()); root = createRoot(host); await render();
  await click('[aria-label="上一题"]');
  expect((host.querySelector('[aria-label="补充说明"]') as HTMLTextAreaElement).value).toBe("角色和场景已经在画布上了");
  expect(host.querySelector("input:checked")).toBeNull();
  await click('[aria-label="上一题"]');
  expect((host.querySelector('[aria-label="补充说明"]') as HTMLTextAreaElement).value).toBe("先不生成，整理提示词");
  expect(host.querySelector("input:checked")).toBeNull();
  await click('[aria-label="下一题"]'); await click('[aria-label="下一题"]');
  onAnswer.mockResolvedValue(false); await click('button[type="submit"]');
  const answer = { values: {}, notes: { model: "先不生成，整理提示词", scope: "角色和场景已经在画布上了" } };
  expect(onAnswer).toHaveBeenCalledWith(answer);
  expect(JSON.parse(sessionStorage.getItem("creative-agent-question:decision:hash")!)).toEqual(answer);
});
it("requires an answer again after clearing a custom answer and rejects whitespace-only notes", async () => {
  await render();
  await fill('[aria-label="补充说明"]', "自定义回答"); await click('button[type="submit"]');
  await click('[aria-label="上一题"]'); await fill('[aria-label="补充说明"]', "");
  await click('button[type="submit"]');
  expect(host.textContent).toContain("1/3");
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("图片模型");
  await fill('[aria-label="补充说明"]', "  "); await click('button[type="submit"]');
  expect(host.textContent).toContain("1/3");
  expect(onAnswer).not.toHaveBeenCalled();
});
it("replaces an ignored question with its custom answer and clears that answer if ignored again", async () => {
  await render(); await click('[aria-label="忽略本题"]'); await click('[aria-label="上一题"]');
  await fill('[aria-label="补充说明"]', "先不生成");
  expect(host.textContent).not.toContain("已忽略此题");
  await click('button[type="submit"]');
  await click('input[value="people"]'); await click('button[type="submit"]');
  onAnswer.mockResolvedValue(false); await click('button[type="submit"]');
  expect(onAnswer).toHaveBeenLastCalledWith({ values: { scope: "people" }, notes: { model: "先不生成" }, skippedFields: [] });
  await click('[aria-label="上一题"]'); await click('[aria-label="上一题"]'); await click('[aria-label="忽略本题"]');
  await click('[aria-label="上一题"]');
  expect((host.querySelector('[aria-label="补充说明"]') as HTMLTextAreaElement).value).toBe("");
  await click('[aria-label="下一题"]'); await click('[aria-label="忽略本题"]'); await click('[aria-label="忽略本题"]');
  expect(onAnswer).toHaveBeenLastCalledWith({ skipped: true });
});
it("restores the page and answers after remount and preserves them on network failure", async () => {
  await render(); await click('input[value="seedream"]'); await click('button[type="submit"]');
  await click('input[value="all"]'); await click('button[type="submit"]');
  await fill('[aria-label="外观调整"]', "保留服装");
  await act(async () => root.unmount()); root = createRoot(host); await render();
  expect(host.textContent).toContain("3/3");
  expect((host.querySelector('[aria-label="外观调整"]') as HTMLInputElement).value).toBe("保留服装");
  await click('[aria-label="上一题"]'); await click('[aria-label="上一题"]');
  expect((host.querySelector('input[value="seedream"]') as HTMLInputElement).checked).toBe(true);
  await click('[aria-label="下一题"]'); await click('[aria-label="下一题"]');
  onAnswer.mockResolvedValue(false); await click('button[type="submit"]');
  expect(sessionStorage.getItem("creative-agent-question:decision:hash")).toContain("保留服装");
});
it("ignores only the current question and can revise that choice before submitting", async () => {
  await render(); await click('[aria-label="忽略本题"]');
  expect(host.textContent).toContain("2/3");
  expect(onAnswer).not.toHaveBeenCalled();
  await click('input[value="people"]'); await click('button[type="submit"]');
  await click('button[type="submit"]');
  expect(onAnswer).toHaveBeenCalledWith({ values: { scope: "people" }, skippedFields: ["model"] });
});
it("does not allow arrow navigation to bypass a required unanswered field", async () => {
  await render(); await click('[aria-label="下一题"]'); await click('[aria-label="下一题"]');
  await click('button[type="submit"]');
  expect(host.textContent).toContain("1/3");
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("图片模型");
  expect(onAnswer).not.toHaveBeenCalled();
});
it("skips all questions without inventing values, and disables actions while offline", async () => {
  await render(true); await click('[aria-label="忽略本题"]');
  expect(onAnswer).not.toHaveBeenCalled();
  expect([...host.querySelectorAll("fieldset")].every(field => field.disabled)).toBe(true);
  await render();
  for (let index = 0; index < fields.length; index++) await click('[aria-label="忽略本题"]');
  expect(onAnswer).toHaveBeenCalledWith({ skipped: true });
});
it("clears a skip when the user goes back and selects an answer", async () => {
  await render(); await click('[aria-label="忽略本题"]');
  await click('[aria-label="上一题"]'); await click('input[value="gpt"]'); await click('button[type="submit"]');
  await click('input[value="people"]'); await click('button[type="submit"]'); await click('button[type="submit"]');
  expect(onAnswer).toHaveBeenCalledWith({ values: { model: "gpt", scope: "people" }, skippedFields: [] });
});
it("sends one final answer even when continue is clicked twice", async () => {
  await render(); await click('input[value="gpt"]'); await click('button[type="submit"]');
  await click('input[value="people"]'); await click('button[type="submit"]');
  let finish!: (value: boolean) => void;
  onAnswer.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await act(async () => { const button = host.querySelector('button[type="submit"]') as HTMLButtonElement; button.click(); button.click(); });
  expect(onAnswer).toHaveBeenCalledTimes(1);
  await act(async () => finish(true));
});
