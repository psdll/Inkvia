// @vitest-environment jsdom
import * as React from "react";
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/creative-agent/client", async (original) => {
  const actual = await original<typeof import("@/lib/creative-agent/client")>();
  return {
    ...actual,
    creativeAgentClient: {
      capabilities: vi.fn(),
      sessions: vi.fn(),
      summarizeSession: vi.fn(),
      session: vi.fn(),
      send: vi.fn(),
      events: vi.fn(),
      control: vi.fn(),
      answer: vi.fn(),
    },
  };
});
vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => ({ user: { id: 1 } }) }));
vi.mock("@/lib/role-skills/client", async (original) => ({
  ...await original<typeof import("@/lib/role-skills/client")>(),
  getSystemRoleSkillClient: vi.fn(async () => ({ id: "system:3", name: "workflow · 视频制作", summary: "完整流程", source: "system", revision: 1, category: "创作流程", content: "技能正文" })),
  getPersonalRoleSkillClient: vi.fn(async () => ({ id: "personal:9", name: "我的摄影技能", summary: "自定义摄影方法", source: "personal", revision: 2, mediaType: "image", category: "摄影" })),
  updatePersonalRoleSkillClient: vi.fn(async (_id, value) => ({ ...value, id: "personal:9", source: "personal", revision: 3 })),
  deletePersonalRoleSkillClient: vi.fn(async () => {}),
  listRoleSkills: vi.fn(async () => [
    { id: "system:3", name: "workflow · 视频制作", summary: "完整流程", source: "system", revision: 1, mediaType: "text", category: "创作流程", usageScenario: "" },
    { id: "personal:9", name: "我的摄影技能", summary: "自定义摄影方法", source: "personal", revision: 2, mediaType: "image", category: "摄影", usageScenario: "" },
  ]),
}));
vi.mock("@/components/role-skills/role-skill-editor", () => ({ RoleSkillEditor: ({ initialValue, onSave, onCancel }: any) => React.createElement("div", null,
  React.createElement("span", null, `编辑中：${initialValue?.name}`),
  React.createElement("button", { onClick: () => onSave({ ...initialValue, name: "修改后的技能" }) }, "保存技能"),
  React.createElement("button", { onClick: onCancel }, "取消编辑")) }));
import { getSystemRoleSkillClient, getPersonalRoleSkillClient, updatePersonalRoleSkillClient, deletePersonalRoleSkillClient, listRoleSkills } from "@/lib/role-skills/client";
import CanvasAgentPanel, {
  type CanvasAgentPanelProps,
} from "@/components/creative-agent/CanvasAgentPanel";
import {
  creativeAgentClient as client,
} from "@/lib/creative-agent/client";
import type {
  CreativeAgentRun,
  CreativeAgentSessionSnapshot,
} from "@/lib/creative-agent/contracts";
let root: Root;
let host: HTMLDivElement;
const blank: CreativeAgentSessionSnapshot = {
  sessionId: null,
  messages: [],
  run: null,
  latestSequence: 0,
};
const run: CreativeAgentRun = {
  id: "r",
  sessionId: "s",
  canvasId: 17,
  status: "running",
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
};
let props: CanvasAgentPanelProps;
const render = async () => {
  await act(async () =>
    root.render(React.createElement(CanvasAgentPanel, props)),
  );
};
const click = async (label: string) => {
  await act(async () => {
    const button = [...document.querySelectorAll("button")].find(
      (button) =>
        button.textContent?.includes(label) ||
        button.getAttribute("aria-label") === label,
    );
    expect(button, label).toBeDefined();
    button!.click();
  });
};
beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
  Object.defineProperty(Range.prototype, "getClientRects", { configurable: true, value: () => [] });
  Object.defineProperty(Range.prototype, "getBoundingClientRect", { configurable: true, value: () => new DOMRect() });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  vi.mocked(client.capabilities).mockResolvedValue({
    enabled: true,
    ready: true,
    reason: null,
    protocolVersion: 1,
  });
  vi.mocked(client.session).mockResolvedValue(blank);
  const session = { id: "s", title: "创作对话", titleSource: "auto" as const, titleMessageId: null, lastMessageId: null, messageCount: 0, createdAt: "2026-01-01", updatedAt: "2026-01-01" };
  vi.mocked(client.sessions).mockResolvedValue({ sessions: [session] });
  vi.mocked(client.summarizeSession).mockResolvedValue({ session });
  vi.mocked(client.send).mockResolvedValue({ sessionId: "s", runId: "r" });
  vi.mocked(client.events).mockResolvedValue({
    events: [],
    nextSequence: 0,
    run,
  });
  vi.mocked(client.control).mockResolvedValue({
    run: { ...run, status: "stopping" },
  });
  vi.mocked(client.answer).mockResolvedValue({});
  props = {
    canvasId: 17,
    selection: {
      nodeIds: ["n"],
      edgeIds: [],
      references: [
        {
          canvasId: 17,
          nodeId: "n",
          kind: "image",
          label: "角色",
          outputId: "out1",
        },
      ],
    },
    onPrepareMessage: vi.fn(async () => ({
      canvasId: 17,
      revision: "42",
      selection: props.selection,
    })),
    onCanvasCommitted: vi.fn(async () => {}),
    onLocateNode: vi.fn(),
    onClose: vi.fn(),
  };
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
describe("unified Agent skill UI", () => {
  it("hides command IDs and keeps only details in both skill lists", async () => {
    await render();
    await click("技能指令");
    const popup = () => document.querySelector('[aria-label="技能 Skill"]')!;
    expect(popup().textContent).not.toContain("/skill:");
    expect(popup().querySelector('[aria-label^="编辑"]')).toBeNull();
    expect(popup().querySelector('[aria-label^="删除"]')).toBeNull();
    await click("我的");
    expect(popup().textContent).not.toContain("编辑");
    expect(popup().textContent).not.toContain("删除");
    expect(popup().querySelector('[aria-label="详情我的摄影技能"]')).not.toBeNull();
    await click("我的摄影技能");
    expect(client.send).not.toHaveBeenCalled();
  });
  it("opens the shared skill detail and closes directly back to Agent", async () => {
    await render(); await click("技能指令"); await click("通用"); await click("详情视频制作");
    expect(getSystemRoleSkillClient).toHaveBeenCalledWith("system:3");
    expect(document.body.textContent).toContain("workflow · 视频制作");
    const detail = document.querySelector('[aria-label="技能 Skill"]')!;
    expect([...detail.querySelectorAll("button")].some(button => ["编辑", "删除"].includes(button.textContent || ""))).toBe(false);
    await click("关闭 Skill 详情");
    expect(document.querySelector('[aria-label="技能 Skill"]')).toBeNull();
  });
  it("loads the chosen personal skill for editing, saves its revision, and refreshes the catalog", async () => {
    await render(); await click("技能指令"); await click("我的"); await click("详情我的摄影技能"); await click("编辑");
    expect(getPersonalRoleSkillClient).toHaveBeenCalledWith("personal:9");
    expect(document.body.textContent).toContain("编辑中：我的摄影技能");
    const reads = vi.mocked(listRoleSkills).mock.calls.length;
    await click("保存技能");
    expect(updatePersonalRoleSkillClient).toHaveBeenCalledWith("personal:9", expect.objectContaining({ name: "修改后的技能", mediaType: "image" }), 2);
    expect(vi.mocked(listRoleSkills).mock.calls.length).toBeGreaterThan(reads);
    expect(document.querySelector('[aria-label="技能 Skill"]')).toBeNull();
  });
  it("requires deletion confirmation and keeps errors visible for retry", async () => {
    await render(); await click("技能指令"); await click("我的"); await click("详情我的摄影技能"); await click("删除");
    expect(deletePersonalRoleSkillClient).not.toHaveBeenCalled();
    await click("取消");
    expect(deletePersonalRoleSkillClient).not.toHaveBeenCalled();
    expect(document.querySelector('[aria-label="技能 Skill"]')).not.toBeNull();
    await click("删除");
    vi.mocked(deletePersonalRoleSkillClient).mockRejectedValueOnce(new Error("删除失败，请重试"));
    await click("删除技能");
    expect(document.body.textContent).toContain("删除失败，请重试");
    const reads = vi.mocked(listRoleSkills).mock.calls.length;
    await click("删除技能");
    expect(deletePersonalRoleSkillClient).toHaveBeenLastCalledWith("personal:9", 2);
    expect(vi.mocked(listRoleSkills).mock.calls.length).toBeGreaterThan(reads);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
});
