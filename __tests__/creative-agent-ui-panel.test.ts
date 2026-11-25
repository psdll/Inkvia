// @vitest-environment jsdom
import * as React from "react";
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const auth = vi.hoisted(() => ({ user: { id: 7 } as { id: number } | null, includeCanonicalSkill: false }));
vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => ({ user: auth.user }) }));
vi.mock("@/hooks/use-role-skill-catalog", () => ({ useRoleSkillCatalog: () => ({
  skills: ["workflow", "canvas", "storyflow", "personal-test", ...(auth.includeCanonicalSkill ? ["personal:21"] : [])].map(id => ({ id, name: id, source: id === "personal-test" ? "personal" : "system", summary: "测试技能", category: "创作", usageScenario: "画布创作" })),
  loading: false, error: null,
}) }));
vi.mock("@/components/role-skills/role-skill-dialog", () => ({ RoleSkillDialog: () => null }));
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
      createSession: vi.fn(),
      revise: vi.fn(),
      events: vi.fn(),
      control: vi.fn(),
      answer: vi.fn(),
    },
  };
});
import CanvasAgentPanel, {
  type CanvasAgentPanelProps,
} from "@/components/creative-agent/CanvasAgentPanel";
import {
  creativeAgentClient as client,
  CreativeAgentClientError,
} from "@/lib/creative-agent/client";
import { getImageModelParams } from "@/lib/generation/image-model-params";
import { getVideoModelSpec } from "@/lib/sora2";
import { creativeToolActivity, creativeToolPresentation } from "@/lib/creative-agent/tool-presentation";
import { applyAgentEvents, emptyAgentState } from "@/components/creative-agent/state";
import type {
  CreativeAgentRun,
  CreativeAgentSessionSnapshot,
} from "@/lib/creative-agent/contracts";
let root: Root;
let host: HTMLDivElement;
let queryCache: QueryClient;
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
    root.render(React.createElement(QueryClientProvider, { client: queryCache }, React.createElement(CanvasAgentPanel, props))),
  );
  if (!vi.isFakeTimers()) await act(async () => { await new Promise<void>(resolve => requestAnimationFrame(() => resolve())); });
};
const fill = async (text: string) => {
  await act(async () => {
    const textarea = host.querySelector("textarea");
    if (!textarea) {
      const editor = host.querySelector<HTMLElement>('[contenteditable="true"]')!;
      editor.innerHTML = "";
      const paragraph = document.createElement("p");
      paragraph.textContent = text;
      editor.append(paragraph);
      editor.dispatchEvent(new Event("input", { bubbles: true }));
      await Promise.resolve();
      return;
    }
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )!.set!.call(textarea, text);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
};
const click = async (label: string) => {
  await act(async () => {
    const button = [...document.body.querySelectorAll("button")].find(
      (button) =>
        button.textContent?.includes(label) ||
        button.getAttribute("aria-label") === label,
    );
    expect(button, label).toBeDefined();
    button!.click();
  });
};

const preferenceDialog = () => document.body.querySelector<HTMLElement>('[role="dialog"][aria-label="创作偏好"]')!;
const refreshVisibility = async () => act(async () => { window.dispatchEvent(new Event("toolbox-model-visibility:changed")); });
const chatCatalog = {
  chat: [
    { providerId: "deepseek", modelId: "deepseek-flash", label: "DeepSeek", thinkingLevels: ["default", "none", "low", "high", "max"], thinkingDefault: "high" },
    { providerId: "bailian", modelId: "qwen3.8-max", label: "Qwen", thinkingLevels: ["default", "none", "low", "medium", "high"], thinkingDefault: "high" },
  ], image: [{ id: "nano-banana-2-1", label: "Nano Banana", params: getImageModelParams("nano-banana-2-1") }], video: [{ id: "doubao-seedance-2-5-260628", label: "Seedance 2.5", params: getVideoModelSpec("doubao-seedance-2-5-260628") }],
};
const cacheKey = (user = 7, session = "s", canvas = 17) => `creative-agent:preferences:v3:${user}:${canvas}:${session}`;
const chooseEffort = async (label: string) => {
  await act(async () => [...preferenceDialog().querySelectorAll<HTMLButtonElement>('[aria-label="思考强度"] button')].find(button => button.textContent === label)!.click());
};

it("applies each preference immediately without save/cancel and keeps it across reopening", async () => {
  await render(); await click("创作偏好");
  expect([...preferenceDialog().querySelectorAll("button")].some(button => ["保存设置", "取消"].includes(button.textContent || ""))).toBe(false);
  await click("Qwen");
  expect(JSON.parse(localStorage.getItem(cacheKey())!).model).toBe("bailian::qwen3.8-max");
  expect(preferenceDialog()).not.toBeNull();
  await chooseEffort("高");
  expect(JSON.parse(localStorage.getItem(cacheKey())!).thinkingLevel).toBe("high");
  await click("图片偏好"); await click("Nano Banana");
  expect(JSON.parse(localStorage.getItem(cacheKey())!).media.image).toEqual({ mode: "explicit", model: "nano-banana-2-1" });
  await click("视频偏好"); await click("Seedance 2.5");
  expect(JSON.parse(localStorage.getItem(cacheKey())!).media.video).toEqual({ mode: "explicit", model: "doubao-seedance-2-5-260628" });
  await click("关闭创作偏好"); await click("创作偏好");
  expect(preferenceDialog().querySelector('[data-model-choice][aria-pressed="true"]')?.textContent).toContain("Seedance 2.5");
  expect(client.send).not.toHaveBeenCalled();
});

it("does not change user preferences just by opening, browsing or closing the panel", async () => {
  const saved = localStorage.getItem(cacheKey());
  await render(); await click("创作偏好");
  for (const tab of ["视频偏好", "图片偏好", "推理模型"]) await click(tab);
  await click("关闭创作偏好");
  expect(localStorage.getItem(cacheKey())).toBe(saved);
  expect(client.send).not.toHaveBeenCalled();
});

it("keeps saved parameters visible but permits a temporary override or text request", async () => {
  sessionStorage.setItem("creative-agent:draft:v1:17:s", "这次只写提示词");
  localStorage.setItem(cacheKey(), JSON.stringify({ model: "deepseek::deepseek-flash", thinkingLevel: "default", media: {
    image: { mode: "auto", params: { quality: "high" } },
  } }));
  await render(); await click("创作偏好"); await click("图片偏好"); await click("Nano Banana");
  expect(JSON.parse(localStorage.getItem(cacheKey())!).media.image).toEqual({ mode: "explicit", model: "nano-banana-2-1", params: { quality: "high" } });
  expect(preferenceDialog().querySelector('[role="alert"]')?.textContent).toContain("图片固定参数");
  await click("关闭创作偏好"); await click("发送创作要求");
  expect(vi.mocked(client.send).mock.calls[0][1].preferences?.image).toEqual({ mode: "explicit", model: "nano-banana-2-1", params: { quality: "high" } });
});

it("moves model and thinking controls into the labelled portal with exactly three tabs", async () => {
  await render();
  expect(host.querySelector('[aria-label="选择模型"]')).toBeNull();
  await click("创作偏好");
  const dialog = preferenceDialog();
  expect(dialog).not.toBeNull();
  expect(host.contains(dialog)).toBe(false);
  expect(dialog.getAttribute("aria-modal")).toBe("true");
  expect([...dialog.querySelectorAll('[role="tab"]')].map(tab => tab.textContent)).toEqual(["视频偏好", "图片偏好", "推理模型"]);
  expect([...dialog.querySelectorAll('[aria-label="思考强度"] button')].map(button => button.textContent)).toEqual(["默认", "低", "高", "最大"]);
});

it("restores the default thinking level from a previously disabled preference before sending", async () => {
  localStorage.setItem(cacheKey(), JSON.stringify({ model: "deepseek::deepseek-flash", thinkingLevel: "none", media: {} }));
  sessionStorage.setItem("creative-agent:draft:v1:17:s", "整理分镜");
  await render(); await click("创作偏好");
  expect(preferenceDialog().querySelector('[aria-label="思考强度"]')?.textContent).not.toContain("关闭");
  expect(preferenceDialog().querySelector('[aria-label="思考强度"] [aria-pressed="true"]')?.textContent).toBe("默认");
  await click("关闭创作偏好"); await click("发送创作要求");
  expect(vi.mocked(client.send).mock.calls[0][1].thinkingLevel).toBe("default");
});

it("saves model-specific effort and sends canonical preferences on the next message", async () => {
  sessionStorage.setItem("creative-agent:draft:v1:17:s", "整理分镜");
  await render();
  await click("创作偏好");
  await chooseEffort("最大");
  await click("Qwen");
  expect(preferenceDialog().querySelector('[aria-label="思考强度"] [aria-pressed="true"]')?.textContent).toBe("默认");
  await chooseEffort("高");
  await click("图片偏好");
  expect(preferenceDialog().textContent).not.toContain("未选择");
  await click("智能匹配模型");
  await click("关闭创作偏好");
  await click("发送创作要求");
  expect(vi.mocked(client.send).mock.calls[0][1]).toMatchObject({ model: { providerId: "bailian", modelId: "qwen3.8-max" }, thinkingLevel: "high", preferences: { image: { mode: "auto" } } });
  expect(JSON.parse(localStorage.getItem(cacheKey())!)).toMatchObject({ model: "bailian::qwen3.8-max", thinkingLevel: "high", media: { image: { mode: "auto" } } });
});

it.each(["关闭创作偏好", "Escape", "backdrop"])("keeps selections on %s and restores focus without closing the Agent", async (method) => {
  await render();
  const trigger = host.querySelector<HTMLButtonElement>('form button[aria-haspopup="dialog"]')!;
  trigger?.focus();
  await click("创作偏好");
  await click("Qwen");
  if (method === "Escape") await act(async () => preferenceDialog().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  else if (method === "backdrop") await act(async () => preferenceDialog().parentElement!.dispatchEvent(new Event("pointerdown", { bubbles: true })));
  else await click(method);
  expect(preferenceDialog()).toBeNull();
  expect(document.activeElement).toBe(trigger);
  expect(props.onClose).not.toHaveBeenCalled();
  await click("创作偏好");
  expect(preferenceDialog().querySelector('[aria-pressed="true"][data-model-choice]')?.textContent).toContain("Qwen");
  expect(JSON.parse(localStorage.getItem(cacheKey())!).model).toBe("bailian::qwen3.8-max");
});

it("defaults an unset conversation to the first available chat model and sends with it", async () => {
  localStorage.removeItem(cacheKey());
  sessionStorage.setItem("creative-agent:draft:v1:17:s", "分析图片");
  await render();
  await click("创作偏好");
  expect(client.send).not.toHaveBeenCalled();
  expect(preferenceDialog().querySelector('[data-model-choice][aria-pressed="true"]')?.textContent).toContain("DeepSeek");
  expect(localStorage.getItem(cacheKey())).toBeNull();
  await click("关闭创作偏好");
  await click("发送创作要求");
  expect(vi.mocked(client.send).mock.calls[0][1]).toMatchObject({ text: "分析图片 @角色", model: { providerId: "deepseek", modelId: "deepseek-flash" }, thinkingLevel: "default" });
  expect(JSON.parse(localStorage.getItem(cacheKey())!).model).toBe("deepseek::deepseek-flash");
});

it("selects the default after the catalog arrives without replacing a saved model", async () => {
  localStorage.removeItem(cacheKey());
  let finishCatalog!: (response: Response) => void;
  vi.mocked(fetch).mockImplementationOnce(() => new Promise<Response>(resolve => { finishCatalog = resolve; }));
  await render();
  await click("创作偏好");
  expect(preferenceDialog().querySelector('[data-model-choice][aria-pressed="true"]')).toBeNull();
  await act(async () => finishCatalog(Response.json(chatCatalog)));
  expect(preferenceDialog().querySelector('[data-model-choice][aria-pressed="true"]')?.textContent).toContain("DeepSeek");
  await click("Qwen");
  await refreshVisibility();
  expect(preferenceDialog().querySelector('[data-model-choice][aria-pressed="true"]')?.textContent).toContain("Qwen");
  await act(async () => root.unmount());
  root = createRoot(host);
  await render();
  await click("创作偏好");
  expect(preferenceDialog().querySelector('[data-model-choice][aria-pressed="true"]')?.textContent).toContain("Qwen");
});

it("keeps the draft and does not invent a default when no chat model is available", async () => {
  localStorage.removeItem(cacheKey());
  sessionStorage.setItem("creative-agent:draft:v1:17:s", "分析图片");
  vi.mocked(fetch).mockResolvedValue(Response.json({ ...chatCatalog, chat: [] }));
  await render();
  await click("发送创作要求");
  expect(client.send).not.toHaveBeenCalled();
  expect(preferenceDialog().querySelector('[data-model-choice][aria-pressed="true"]')).toBeNull();
  expect(host.querySelector('[contenteditable="true"]')?.textContent).toContain("分析图片");
});

it("migrates scoped legacy fixed models and sends absent media as auto", async () => {
  localStorage.removeItem(cacheKey());
  localStorage.setItem("creative-agent:preferences:v2:7:17:s", JSON.stringify({ model: "bailian::qwen3.8-max", thinkingLevel: "high", media: { imageModel: "nano-banana-2-1" } }));
  sessionStorage.setItem("creative-agent:draft:v1:17:s", "分析图片");
  await render();
  await click("发送创作要求");
  expect(vi.mocked(client.send).mock.calls[0][1]).toMatchObject({ model: { providerId: "bailian", modelId: "qwen3.8-max" }, preferences: { image: { mode: "explicit", model: "nano-banana-2-1" } } });
  expect(vi.mocked(client.send).mock.calls[0][1].preferences?.video).toEqual({ mode: "auto" });
  expect(JSON.parse(localStorage.getItem(cacheKey())!)).toMatchObject({ media: { image: { mode: "explicit", model: "nano-banana-2-1" } } });
});

it("hydrates the new account record before saving and preserves records across reload", async () => {
  localStorage.setItem(cacheKey(7), JSON.stringify({ model: "bailian::qwen3.8-max", thinkingLevel: "high", media: {} }));
  localStorage.setItem(cacheKey(8), JSON.stringify({ model: "deepseek::deepseek-flash", thinkingLevel: "max", media: {} }));
  localStorage.setItem("creative-agent:preferences:v1:17:s", JSON.stringify({ model: "bailian::qwen3.8-max", media: { video: "legacy" } }));
  await render();
  auth.user = { id: 8 };
  await render();
  await click("创作偏好");
  expect(preferenceDialog().querySelector('[data-model-choice][aria-pressed="true"]')?.textContent).toContain("DeepSeek");
  expect(preferenceDialog().querySelector('[aria-label="思考强度"] [aria-pressed="true"]')?.textContent).toBe("最大");
  await chooseEffort("高");
  await click("关闭创作偏好");
  expect(JSON.parse(localStorage.getItem(cacheKey(7))!).model).toBe("bailian::qwen3.8-max");
  expect(JSON.parse(localStorage.getItem(cacheKey(8))!)).toMatchObject({ thinkingLevel: "high", media: {} });
  await act(async () => root.unmount());
  root = createRoot(host);
  await render();
  await click("创作偏好");
  expect(preferenceDialog().querySelector('[aria-label="思考强度"] [aria-pressed="true"]')?.textContent).toBe("高");
});

it("does not write anonymous preferences while authentication is unresolved", async () => {
  localStorage.removeItem(cacheKey());
  auth.user = null;
  await render();
  await click("创作偏好");
  expect(preferenceDialog().querySelector('[data-model-choice]')).toBeNull();
  await click("关闭创作偏好");
  expect([...Array(localStorage.length)].map((_, i) => localStorage.key(i)).filter(key => key?.startsWith("creative-agent:preferences:"))).toEqual([]);
});
it("submits explicit image and auto video params while preserving an uncertain request snapshot", async () => {
  sessionStorage.setItem("creative-agent:draft:v1:17:s", "制作图片和视频");
  localStorage.setItem(cacheKey(), JSON.stringify({ model: "deepseek::deepseek-flash", thinkingLevel: "default", media: {
    image: { mode: "explicit", model: "nano-banana-2-1", params: { aspectRatio: "16:9", resolution: "2K" } },
    video: { mode: "auto", params: { duration: 10, generateAudio: false } },
  } }));
  vi.mocked(client.send).mockRejectedValueOnce(new CreativeAgentClientError("连接中断", null));
  await render(); await click("发送创作要求");
  const original = structuredClone(vi.mocked(client.send).mock.calls[0][1]);
  expect(original.preferences).toEqual({
    image: { mode: "explicit", model: "nano-banana-2-1", params: { aspectRatio: "16:9", resolution: "2K" } },
    video: { mode: "auto", params: { duration: 10, generateAudio: false } },
  });
  await click("创作偏好"); await click("视频偏好"); await click("Seedance 2.5"); await click("关闭创作偏好");
  expect(JSON.parse(localStorage.getItem(cacheKey())!).media.video.mode).toBe("explicit");
  await click("核对并重试");
  expect(vi.mocked(client.send).mock.calls[1][1]).toEqual(original);
});

it("refreshes readiness when replacing an unavailable model without sending implicitly", async () => {
  sessionStorage.setItem("creative-agent:draft:v1:17:s", "分析画面");
  vi.mocked(client.capabilities).mockImplementation(async (_signal, model) => ({ enabled: true, ready: model?.providerId !== "bailian", reason: model?.providerId === "bailian" ? "不可用" : null, protocolVersion: 1 }));
  await render(); await click("创作偏好"); await click("Qwen"); await click("关闭创作偏好");
  expect(host.querySelector<HTMLButtonElement>('[aria-label="发送创作要求"]')!.disabled).toBe(true);
  await click("创作偏好"); await click("DeepSeek"); await click("关闭创作偏好");
  expect(vi.mocked(client.capabilities).mock.calls.at(-1)?.[1]).toEqual({ providerId: "deepseek", modelId: "deepseek-flash" });
  expect(host.querySelector<HTMLButtonElement>('[aria-label="发送创作要求"]')!.disabled).toBe(false);
  expect(client.send).not.toHaveBeenCalled();
});

it("reloads each conversation preferences without writing the previous conversation to its cache", async () => {
  const session = (id: string, title: string) => ({ id, title, titleSource: "auto" as const, titleMessageId: null, lastMessageId: "m", messageCount: 1, createdAt: "2026-01-01", updatedAt: "2026-01-01" });
  vi.mocked(client.sessions).mockResolvedValue({ sessions: [session("s", "第一会话"), session("other", "第二会话")] });
  localStorage.setItem("creative-agent:tabs:v1:17", JSON.stringify({ openIds: ["s", "other"], activeId: "s" }));
  const first = { model: "bailian::qwen3.8-max", thinkingLevel: "high", media: {} };
  const second = { model: "deepseek::deepseek-flash", thinkingLevel: "max", media: { video: { mode: "auto" } } };
  localStorage.setItem(cacheKey(), JSON.stringify(first)); localStorage.setItem(cacheKey(7, "other"), JSON.stringify(second));
  await render();
  const visible = () => [...host.querySelectorAll<HTMLElement>('[data-agent-surface]')].find(panel => panel.style.display !== "none")!;
  await act(async () => visible().querySelector<HTMLButtonElement>('[aria-label="历史对话"]')!.click());
  await act(async () => [...visible().querySelectorAll<HTMLButtonElement>('[aria-label="历史对话"][role="dialog"] button')].find(button => button.textContent === "第二会话")!.click());
  await act(async () => visible().querySelector<HTMLButtonElement>('form button[aria-haspopup="dialog"]')!.click());
  expect(preferenceDialog().querySelector('[aria-label="思考强度"] [aria-pressed="true"]')?.textContent).toBe("最大");
  await chooseEffort("高");
  await click("关闭创作偏好");
  expect(JSON.parse(localStorage.getItem(cacheKey())!)).toEqual(first);
  expect(JSON.parse(localStorage.getItem(cacheKey(7, "other"))!)).toEqual({ ...second, thinkingLevel: "high", media: { image: { mode: "auto" }, video: { mode: "auto" } } });
});

it("remembers the preference tab and immediately applied model when reopening", async () => {
  await render(); await click("创作偏好"); await click("图片偏好"); await click("Nano Banana"); await click("关闭创作偏好");
  await click("创作偏好");
  expect(preferenceDialog().querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("图片偏好");
  expect(preferenceDialog().querySelector('[data-model-choice][aria-pressed="true"]')?.textContent).toContain("Nano Banana");
  expect(JSON.parse(localStorage.getItem(cacheKey())!).media).toEqual({ image: { mode: "explicit", model: "nano-banana-2-1" }, video: { mode: "auto" } });
  expect(JSON.parse(localStorage.getItem(cacheKey())!).model).toBe("deepseek::deepseek-flash");
});

it("recovers a failed catalog load through explicit retry and reuses the successful catalog on reopen", async () => {
  const fetchCatalog = vi.fn().mockRejectedValueOnce(new Error("目录暂时不可用")).mockResolvedValue(Response.json(chatCatalog));
  vi.stubGlobal("fetch", fetchCatalog);
  await render(); await click("创作偏好");
  expect(preferenceDialog().textContent).toContain("目录暂时不可用");
  expect(preferenceDialog().querySelector("[data-model-choice]")).toBeNull();
  await click("重试加载模型");
  expect(fetchCatalog).toHaveBeenCalledTimes(2);
  expect(preferenceDialog().textContent).toContain("Qwen");
  expect(preferenceDialog().querySelector("[data-model-choice]")).not.toBeNull();
  await click("关闭创作偏好"); await click("创作偏好");
  expect(fetchCatalog).toHaveBeenCalledTimes(2);
});

it("updates an open preference panel when switches change and blocks a hidden saved model", async () => {
  sessionStorage.setItem("creative-agent:draft:v1:17:s", "保留我的输入");
  await render(); await click("创作偏好");
  vi.mocked(fetch).mockImplementation(async () => Response.json({ ...chatCatalog, chat: [chatCatalog.chat[1]], image: [], video: [] }));
  await refreshVisibility();
  expect(preferenceDialog().textContent).not.toContain("DeepSeek");
  expect(preferenceDialog().textContent).not.toContain("deepseek-flash");
  expect(preferenceDialog().textContent).toContain("Qwen");
  await click("关闭创作偏好"); await click("发送创作要求");
  expect(client.send).not.toHaveBeenCalled();
  expect(preferenceDialog()).not.toBeNull();
  expect(host.querySelector('[aria-label="创作要求"]')!.textContent).toBe("保留我的输入 @角色");
  vi.mocked(fetch).mockImplementation(async () => Response.json(chatCatalog));
  await refreshVisibility();
  expect(preferenceDialog().textContent).toContain("DeepSeek");
});

it("discards old choices when refreshing visibility fails", async () => {
  await render(); await click("创作偏好");
  vi.mocked(fetch).mockRejectedValue(new Error("目录暂时不可用"));
  await refreshVisibility();
  expect(preferenceDialog().textContent).not.toContain("DeepSeek");
  expect(preferenceDialog().textContent).not.toContain("Qwen");
  expect(preferenceDialog().textContent).toContain("目录暂时不可用");
  vi.mocked(fetch).mockImplementation(async () => Response.json({ chat: [], image: [], video: [] }));
  await click("重试加载模型");
  expect(preferenceDialog().querySelectorAll('[data-model-choice]')).toHaveLength(0);
});

it("ignores an older catalog response after a newer visibility refresh", async () => {
  let finishOld!: (response: Response) => void;
  vi.mocked(fetch).mockImplementationOnce(() => new Promise<Response>(resolve => { finishOld = resolve; }));
  await render();
  vi.mocked(fetch).mockImplementation(async () => Response.json({ ...chatCatalog, chat: [chatCatalog.chat[1]] }));
  await refreshVisibility();
  await act(async () => { finishOld(Response.json(chatCatalog)); });
  await click("创作偏好");
  expect(preferenceDialog().textContent).toContain("Qwen");
  expect(preferenceDialog().textContent).not.toContain("DeepSeek");
});

beforeEach(() => {
  queryCache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.clearAllMocks();
  auth.user = { id: 7 };
  auth.includeCanonicalSkill = false;
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(chatCatalog)));
  sessionStorage.clear();
  localStorage.setItem(cacheKey(), JSON.stringify({ model: "deepseek::deepseek-flash", thinkingLevel: "default", media: {} }));
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
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
  localStorage.clear();
  await act(async () => root.unmount());
  queryCache.clear();
  host.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
describe("canvas Agent panel interactions", () => {
  it("restores skill list scroll immediately on reopening and remounting, independently per category", async () => {
    props.canvasId = 1810;
    const list = () => document.body.querySelector<HTMLElement>('[aria-label="技能列表"]')!;
    await render();
    await click("技能指令");
    await act(async () => {
      document.body.querySelector<HTMLButtonElement>('[aria-label="技能分类"] button')!.click();
    });
    await act(async () => {
      list().scrollTop = 250;
      list().dispatchEvent(new Event("scroll"));
    });
    await click("技能指令");
    await click("技能指令");
    expect(list().scrollTop).toBe(250);
    await click("我的");
    expect(list().scrollTop).toBe(0);
    await act(async () => {
      document.body.querySelector<HTMLButtonElement>('[aria-label="技能分类"] button')!.click();
    });
    expect(list().scrollTop).toBe(250);
    await act(async () => root.unmount());
    root = createRoot(host);
    await render();
    await click("技能指令");
    expect(list().scrollTop).toBe(250);
    auth.user = { id: 8 };
    await render();
    await click("技能指令");
    await click("技能指令");
    expect(list().scrollTop).toBe(0);
  });

  it("does not auto-scroll skills on mount or mouse hover, but keeps keyboard navigation visible", async () => {
    props.canvasId = 1811;
    await render();
    const scrollIntoView = vi.mocked(HTMLElement.prototype.scrollIntoView);
    scrollIntoView.mockClear();
    await click("技能指令");
    expect(scrollIntoView).not.toHaveBeenCalled();
    const options = [...document.body.querySelectorAll<HTMLElement>('[aria-label="技能列表"] [role="option"]')];
    await act(async () => options[1].dispatchEvent(new MouseEvent("mouseover", { bubbles: true })));
    expect(options[1].getAttribute("aria-selected")).toBe("true");
    expect(scrollIntoView).not.toHaveBeenCalled();
    await act(async () => {
      document.body.querySelector<HTMLInputElement>('[aria-label="搜索技能"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    });
    expect(options[2].getAttribute("aria-selected")).toBe("true");
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView.mock.instances[0]).toBe(options[2]);
  });

  it("lists system and personal skills under All before the other categories and remembers it", async () => {
    props.canvasId = 1804;
    await render();
    await click("技能指令");
    const categories = () => [...document.body.querySelectorAll<HTMLButtonElement>('[aria-label="技能分类"] button')];
    const options = () => [...document.body.querySelectorAll('[aria-label="技能列表"] [role="option"]')].map(item => item.textContent);
    expect(categories().map(button => button.textContent)).toEqual(["全部", "通用", "收藏", "我的"]);
    expect(options()).toHaveLength(3);
    await act(async () => categories()[0].click());
    expect(options()).toHaveLength(4);
    expect(options().some(text => text?.includes("personal-test"))).toBe(true);
    await click("技能指令");
    await click("技能指令");
    expect(categories()[0].getAttribute("aria-pressed")).toBe("true");
    await act(async () => {
      const search = document.body.querySelector<HTMLInputElement>('[aria-label="搜索技能"]')!;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(search, "personal-test");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(options()).toHaveLength(1);
    expect(options()[0]).toContain("personal-test");
  });

  it("remembers the last skill category when reopening and remounting, scoped to account and canvas", async () => {
    props.canvasId = 1801;
    const selectedTab = () => document.body.querySelector('[aria-label="技能分类"] button[aria-pressed="true"]')?.textContent;
    await render();
    await click("技能指令");
    expect(selectedTab()).toBe("通用");
    await click("我的");
    await click("技能指令");
    await click("技能指令");
    expect(selectedTab()).toBe("我的");
    await act(async () => root.unmount());
    root = createRoot(host);
    await render();
    await click("技能指令");
    expect(selectedTab()).toBe("我的");
    auth.user = { id: 8 };
    await render();
    await click("技能指令");
    await click("技能指令");
    expect(selectedTab()).toBe("通用");
    auth.user = { id: 7 };
    props.canvasId = 1803;
    await render();
    await click("技能指令");
    expect(selectedTab()).toBe("通用");
    props.canvasId = 1801;
    await render();
    await click("技能指令");
    expect(selectedTab()).toBe("我的");
  });

  it("keeps the selected skill category when typing a slash", async () => {
    props.canvasId = 1802;
    await render();
    await click("技能指令");
    await click("收藏");
    await click("技能指令");
    await act(async () => {
      const editor = host.querySelector<HTMLElement>('[contenteditable="true"]')!;
      editor.focus();
      editor.innerHTML = "<p>/</p>";
      const range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(false);
      window.getSelection()!.removeAllRanges();
      window.getSelection()!.addRange(range);
      editor.dispatchEvent(new Event("input", { bubbles: true }));
      await Promise.resolve();
    });
    expect(document.body.querySelector('[aria-label="技能分类"] button[aria-pressed="true"]')?.textContent).toBe("收藏");
  });

  it("remembers the last mention tab when reopening the menu and remounting the panel", async () => {
    props.canvasId = 1701;
    await render();
    const selectedTab = () => host.querySelector('[role="dialog"][aria-label="提及输出与素材"] button[aria-pressed="true"]')?.textContent;
    await click("提及节点输出或素材");
    expect(selectedTab()).toBe("当前画布");
    await click("已选引用");
    await click("关闭菜单");
    await click("提及节点输出或素材");
    expect(selectedTab()).toBe("已选引用");
    await click("全局素材");
    await click("提及节点输出或素材");
    await click("提及节点输出或素材");
    expect(selectedTab()).toBe("全局素材");
    await act(async () => root.unmount());
    root = createRoot(host);
    await render();
    await click("提及节点输出或素材");
    expect(selectedTab()).toBe("全局素材");
    auth.user = { id: 8 };
    await render();
    await click("关闭菜单");
    await click("提及节点输出或素材");
    expect(selectedTab()).toBe("当前画布");
  });

  it("keeps the selected mention tab when typing an at sign", async () => {
    props.canvasId = 1702;
    await render();
    await click("提及节点输出或素材");
    await click("已选引用");
    await click("关闭菜单");
    await act(async () => {
      const editor = host.querySelector<HTMLElement>('[contenteditable="true"]')!;
      editor.focus();
      editor.innerHTML = "<p>@</p>";
      const range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(false);
      window.getSelection()!.removeAllRanges();
      window.getSelection()!.addRange(range);
      editor.dispatchEvent(new Event("input", { bubbles: true }));
      await Promise.resolve();
    });
    expect(host.querySelector('[role="dialog"][aria-label="提及输出与素材"] button[aria-pressed="true"]')?.textContent).toBe("已选引用");
  });

  it("omits empty sessions from history and reuses the current blank conversation", async () => {
    const sessions = [
      { id: "s", title: "当前空白", titleSource: "auto" as const, titleMessageId: null, lastMessageId: null, messageCount: 0, createdAt: "2026-01-01", updatedAt: "2026-01-01" },
      { id: "empty", title: "旧空白", titleSource: "auto" as const, titleMessageId: null, lastMessageId: null, messageCount: 0, createdAt: "2026-01-02", updatedAt: "2026-01-02" },
      { id: "real", title: "新对话", titleSource: "auto" as const, titleMessageId: null, lastMessageId: "m", messageCount: 1, createdAt: "2026-01-03", updatedAt: "2026-01-03" },
    ];
    vi.mocked(client.sessions).mockResolvedValue({ sessions });
    await render();
    const history = () => host.querySelector('[aria-label="历史对话"][role="dialog"]')!;
    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="历史对话"]')!.click());
    expect([...history().querySelectorAll('button')].map(button => button.textContent)).toEqual(["新对话"]);
    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="新建对话"]')!.click());
    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="新建对话"]')!.click());
    expect(client.createSession).not.toHaveBeenCalled();
  });
  it("shows a conversation in history after its first recorded message", async () => {
    const session = { id: "s", title: "新对话", titleSource: "auto" as const, titleMessageId: null, lastMessageId: null, messageCount: 0, createdAt: "2026-01-01", updatedAt: "2026-01-01" };
    vi.mocked(client.sessions).mockResolvedValue({ sessions: [session] });
    await render();
    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="历史对话"]')!.click());
    expect(host.querySelector('[role="dialog"][aria-label="历史对话"]')?.textContent).toContain("暂无历史对话");
    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="历史对话"]')!.click());
    vi.mocked(client.sessions).mockResolvedValue({ sessions: [{ ...session, messageCount: 1, lastMessageId: "m" }] });
    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="历史对话"]')!.click());
    expect(host.querySelector('[role="dialog"][aria-label="历史对话"] button')?.textContent).toBe("新对话");
  });

  it("shows one complete title and switches conversation records through the right-side history control", async () => {
    const firstTitle = "这是之前保存的完整长标题应该显示完整内容";
    const sessions = [
      { id: "s", title: firstTitle, titleSource: "manual" as const, titleMessageId: null, lastMessageId: null, messageCount: 2, createdAt: "2026-01-01", updatedAt: "2026-01-01" },
      { id: "other", title: "自然光客厅产品图", titleSource: "auto" as const, titleMessageId: null, lastMessageId: null, messageCount: 2, createdAt: "2026-01-02", updatedAt: "2026-01-02" },
    ];
    localStorage.setItem("creative-agent:tabs:v1:17", JSON.stringify({ openIds: ["s", "other"], activeId: "s" }));
    sessionStorage.setItem("creative-agent:draft:v1:17:s", "当前对话草稿");
    sessionStorage.setItem("creative-agent:draft:v1:17:other", "另一个对话草稿");
    vi.mocked(client.sessions).mockResolvedValue({ sessions });
    vi.mocked(client.session).mockImplementation(async (_, __, id) => ({ ...blank, sessionId: id || "s", session: sessions.find(item => item.id === id) }));
    const visiblePanel = () => [...host.querySelectorAll<HTMLElement>('[data-agent-surface]')].find(item => item.style.display !== "none")!;
    await render();
    let header = visiblePanel().querySelector("header")!;
    expect(header.querySelectorAll('[data-agent-title]')).toHaveLength(1);
    expect(header.querySelector('[data-agent-title]')?.textContent).toBe(firstTitle);
    expect(host.querySelector('[role="tablist"]')).toBeNull();
    expect(host.querySelector('[aria-label^="关闭对话标签"]')).toBeNull();
    const history = header.querySelector<HTMLButtonElement>('[aria-label="历史对话"]')!;
    expect(history.parentElement?.querySelector('[aria-label="新建对话"]')).not.toBeNull();
    expect(visiblePanel().querySelector('form button[aria-haspopup="dialog"]')?.textContent).toBe("创作偏好");
    await act(async () => history.click());
    await act(async () => { [...visiblePanel().querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(button => button.textContent === sessions[1].title)!.click(); });
    header = visiblePanel().querySelector("header")!;
    expect(header.querySelector('[data-agent-title]')?.textContent).toBe(sessions[1].title);
    expect(visiblePanel().querySelector('[aria-label="创作要求"]')?.textContent).toBe("另一个对话草稿 @角色");
    await act(async () => header.querySelector<HTMLButtonElement>('[aria-label="历史对话"]')!.click());
    await act(async () => { [...visiblePanel().querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(button => button.textContent === firstTitle)!.click(); });
    expect(visiblePanel().querySelector('[data-agent-title]')?.textContent).toBe(firstTitle);
    expect(visiblePanel().querySelector('[aria-label="创作要求"]')?.textContent).toBe("当前对话草稿 @角色");
    expect(client.send).not.toHaveBeenCalled();
    localStorage.removeItem("creative-agent:tabs:v1:17");
  });
  it("edits only the latest eligible question in place without changing the composer draft", async () => {
    const messages = [
      { id: "old", role: "user" as const, text: "前面的提问", runId: "previous", createdAt: "2025-12-31" },
      { id: "latest", role: "user" as const, text: "最新的提问", runId: run.id, createdAt: run.createdAt },
    ];
    sessionStorage.setItem("creative-agent:draft:v1:17:s", "底部草稿保持不变");
    vi.mocked(client.session).mockResolvedValue({ ...blank, sessionId: "s", run, messages, editableMessageId: "latest" });
    vi.mocked(client.events).mockResolvedValue({ run, events: [], nextSequence: 0, editableMessageId: "latest" });
    await render();
    expect(host.querySelectorAll('[aria-label="编辑消息"]')).toHaveLength(1);
    expect(host.querySelectorAll('[aria-label="你的消息"]')[0].querySelector('[aria-label="编辑消息"]')).toBeNull();
    await click("编辑消息");
    const editor = host.querySelector<HTMLTextAreaElement>('[aria-label="修改这条提问"]')!;
    expect(editor.closest('[aria-label="你的消息"]')).not.toBeNull();
    expect(editor.value).toBe("最新的提问");
    await fill("原位修改后的要求");
    await click("取消修改");
    expect(host.querySelector('[aria-label="修改这条提问"]')).toBeNull();
    expect(sessionStorage.getItem("creative-agent:draft:v1:17:s")).toBe("底部草稿保持不变");
    expect(client.revise).not.toHaveBeenCalled();
    await click("编辑消息");
    await fill("原位修改后的要求");
    vi.mocked(client.revise).mockResolvedValue({ ...blank, sessionId: "s", run: { ...run, status: "queued" }, messages: [messages[0], { ...messages[1], text: "原位修改后的要求" }], editableMessageId: "latest" });
    await click("发送修改");
    expect(client.revise).toHaveBeenCalledWith(17, expect.objectContaining({ runId: "r", messageId: "latest", expectedText: "最新的提问", text: "原位修改后的要求" }));
    expect(host.querySelector('[aria-label="修改这条提问"]')).toBeNull();
    expect(sessionStorage.getItem("creative-agent:draft:v1:17:s")).toBe("底部草稿保持不变");
    expect(client.send).not.toHaveBeenCalled();
  });
  it("keeps the unsent edit after a 409 revision conflict while restoring the current server text", async () => {
    const message = { id: "latest", role: "user" as const, text: "旧要求", runId: run.id, createdAt: run.createdAt };
    const snapshot = { ...blank, sessionId: "s", run, messages: [message], editableMessageId: "latest" };
    vi.mocked(client.session).mockResolvedValue(snapshot);
    vi.mocked(client.events).mockResolvedValue({ run, events: [], nextSequence: 0, editableMessageId: "latest" });
    await render(); await click("编辑消息"); await fill("还没被接受的新意图");
    vi.mocked(client.revise).mockRejectedValueOnce(new CreativeAgentClientError("这条提问已在其他页面修改", 409));
    vi.mocked(client.session).mockResolvedValue({ ...snapshot, messages: [{ ...message, text: "另一页已提交的要求" }] });
    await click("发送修改");
    expect(host.querySelector<HTMLTextAreaElement>('[aria-label="修改这条提问"]')?.value).toBe("还没被接受的新意图");
    expect(client.session).toHaveBeenCalledWith(17, undefined, "s");
    await click("取消修改");
    expect(host.querySelector('[aria-label="你的消息"]')?.textContent).toContain("另一页已提交的要求");
    expect(client.send).not.toHaveBeenCalled();
  });
  it("closes editing eligibility when execution advances, keeping the unsent inline text", async () => {
    vi.useFakeTimers();
    const message = { id: "latest", role: "user" as const, text: "新的要求", runId: run.id, createdAt: run.createdAt };
    vi.mocked(client.session).mockResolvedValue({ ...blank, run, messages: [message], editableMessageId: "latest" });
    vi.mocked(client.events).mockResolvedValueOnce({ run, events: [], nextSequence: 0, editableMessageId: "latest" })
      .mockResolvedValue({ run, events: [], nextSequence: 0, editableMessageId: null });
    await render(); await click("编辑消息"); await fill("还没发出的修改");
    await act(async () => vi.advanceTimersByTimeAsync(1500));
    expect(host.querySelector<HTMLButtonElement>('[aria-label="发送修改"]')?.disabled).toBe(true);
    expect(host.querySelector<HTMLTextAreaElement>('[aria-label="修改这条提问"]')?.value).toBe("还没发出的修改");
    await click("取消修改");
    expect(host.querySelector('[aria-label="编辑消息"]')).toBeNull();
  });
  it("ignores a late preparation error while the revised question is being submitted", async () => {
    vi.useFakeTimers();
    const message = { id: "latest", role: "user" as const, text: "旧要求", runId: run.id, createdAt: run.createdAt };
    const snapshot = { ...blank, sessionId: "s", run, messages: [message], editableMessageId: "latest" };
    let rejectOld!: (error: Error) => void;
    let acceptEdit!: (value: CreativeAgentSessionSnapshot) => void;
    const latePoll = new Promise<never>((_, reject) => { rejectOld = reject; });
    vi.mocked(client.session).mockResolvedValue(snapshot);
    vi.mocked(client.events).mockResolvedValueOnce({ run, events: [], nextSequence: 0, editableMessageId: "latest" })
      .mockReturnValueOnce(latePoll).mockResolvedValue({ run, events: [], nextSequence: 0, editableMessageId: "latest" });
    vi.mocked(client.revise).mockReturnValue(new Promise(resolve => { acceptEdit = resolve; }));
    await render();
    await act(async () => vi.advanceTimersByTimeAsync(1200));
    await click("编辑消息"); await fill("新要求"); await click("发送修改");
    await act(async () => { rejectOld(new Error("旧任务连接已关闭")); });
    expect(host.textContent).not.toContain("旧任务连接已关闭");
    await act(async () => { acceptEdit({ ...snapshot, messages: [{ ...message, text: "新要求" }] }); });
    expect(host.querySelector('[aria-label="修改这条提问"]')).toBeNull();
    expect(host.querySelector('[aria-label="你的消息"]')?.textContent).toContain("新要求");
  });
  it.each(["queued", "running", "waiting_decision", "waiting_action", "paused", "stopping"] as const)("hides reply actions while the turn is %s even after a message completes", async (status) => {
    const current = { ...run, status };
    vi.mocked(client.session).mockResolvedValue({ ...blank, run: current, messages: [
      { id: "interim", role: "assistant", text: "先确认需求，再继续处理", runId: run.id, createdAt: run.createdAt },
    ] });
    vi.mocked(client.events).mockResolvedValue({ run: current, nextSequence: 0, events: [] });
    await render();
    expect(host.querySelector('[aria-label="Agent 消息"] button')).toBeNull();
    expect(host.querySelector('[aria-label="本轮回复操作"]')).toBeNull();
  });
  it("shows only the final reply actions after the terminal event log has drained", async () => {
    vi.useFakeTimers();
    const completed = { ...run, status: "completed" as const };
    vi.mocked(client.session).mockResolvedValue({ ...blank, run, messages: [
      { id: "interim", role: "assistant", text: "开始处理", runId: run.id, createdAt: run.createdAt },
    ] });
    vi.mocked(client.events)
      .mockResolvedValueOnce({ run: completed, nextSequence: 1, events: [{ sequence: 1, runId: run.id, type: "message.completed", createdAt: run.createdAt, payload: { message: { id: "final", role: "assistant", text: "已经全部处理完成" } } }] })
      .mockResolvedValue({ run: completed, nextSequence: 1, events: [] });
    await render();
    expect(host.querySelectorAll('[aria-label="Agent 消息"]')).toHaveLength(2);
    expect(host.querySelector('[aria-label="Agent 消息"] button')).toBeNull();
    expect(host.querySelector('[aria-label="本轮回复操作"]')).toBeNull();
    await act(async () => vi.advanceTimersByTimeAsync(100));
    expect(host.querySelectorAll('[aria-label="本轮回复操作"]')).toHaveLength(1);
    expect(host.querySelector('[aria-label="复制本轮全部结果"]')).not.toBeNull();
  });
  it("keeps earlier turn actions available while the current turn is running", async () => {
    vi.mocked(client.session).mockResolvedValue({ ...blank, run, messages: [
      { id: "previous-step", role: "assistant", text: "前一轮处理中", runId: "previous", createdAt: run.createdAt },
      { id: "previous-final", role: "assistant", text: "前一轮已完成", runId: "previous", createdAt: run.createdAt },
      { id: "current", role: "assistant", text: "本轮处理中", runId: run.id, createdAt: run.createdAt },
    ] });
    await render();
    const messages = host.querySelectorAll('[aria-label="Agent 消息"]');
    expect(messages[0].querySelector('button')).toBeNull();
    expect(messages[1].nextElementSibling?.getAttribute('aria-label')).toBe("本轮回复操作");
    expect(messages[2].querySelector('button')).toBeNull();
    expect(host.querySelectorAll('[aria-label="本轮回复操作"]')).toHaveLength(1);
  });
  it("waits for pending media before exposing terminal reply actions", async () => {
    const completed = { ...run, status: "completed" as const };
    vi.mocked(client.session).mockResolvedValue({ ...blank, run: completed, mediaPending: true, messages: [
      { id: "pending", role: "assistant", text: "正在同步生成结果", runId: run.id, createdAt: run.createdAt },
    ] });
    vi.mocked(client.events).mockResolvedValue({ run: completed, nextSequence: 0, events: [], mediaPending: true });
    await render();
    expect(host.querySelector('[aria-label="Agent 消息"] button')).toBeNull();
    expect(host.querySelector('[aria-label="本轮回复操作"]')).toBeNull();
  });
  it("copies the whole turn below media results and displays its persisted completion time", async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", new Proxy(navigator, { get: (target, key) => key === "clipboard" ? { writeText } : Reflect.get(target, key, target) }));
    const completed = { ...run, status: "completed" as const, updatedAt: "2026-10-14T11:58:00Z" };
    const media = { generationId: 12, runId: run.id, status: "success", mediaType: "image" as const, model: "m", nodeIds: ["n"], outputs: [{ url: "/uploads/result.png" }], createdAt: run.createdAt };
    vi.mocked(client.session).mockResolvedValue({ ...blank, run: completed, media: [media], messages: [
      { id: "first", role: "assistant", text: "本轮第一段回复", runId: run.id, createdAt: run.createdAt },
      { id: "last", role: "assistant", text: "本轮最终回复", runId: run.id, createdAt: run.createdAt },
    ] });
    vi.mocked(client.events).mockResolvedValue({ run: completed, events: [], nextSequence: 0, media: [media], mediaPending: false });
    await render();
    const footer = host.querySelector('[aria-label="本轮回复操作"]')!;
    expect(footer).not.toBeNull();
    // 新版不再显示固定模板“本轮生成结果说明”，收尾消息紧挨在操作栏上方
    expect(footer.previousElementSibling?.getAttribute('aria-label')).toBe("Agent 消息");
    expect(footer.querySelectorAll('button')).toHaveLength(1);
    expect(footer.querySelector('time')?.getAttribute('datetime')).toBe("2026-10-14T11:58:00.000Z");
    await click("复制本轮全部结果");
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("本轮第一段回复\n\n本轮最终回复"));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("/uploads/result.png)"));
    expect(host.querySelector('[aria-label="下载回答 Markdown"]')).toBeNull();
  });
  it("lets a pending media plan be revised without approving it and retains feedback for an idempotent retry", async () => {
    const waiting = { ...run, status: "waiting_decision" as const };
    vi.mocked(client.session).mockResolvedValue({ ...blank, sessionId: "s", run: waiting });
    vi.mocked(client.events).mockResolvedValue({ run: waiting, nextSequence: 1, events: [{ sequence: 1, runId: "r", type: "decision.requested", createdAt: run.createdAt, payload: {
      decisionId: "revise-plan", proposalHash: "original-hash", title: "确认生成", question: "生成1张图片", options: [{ value: "approve", label: "确认生成" }, { value: "cancel", label: "取消" }],
      media: { mediaType: "image", model: { id: "test", label: "测试模型" }, prompt: "豪华酒店", params: {}, units: 1, references: [] },
    } }] });
    vi.mocked(client.answer).mockRejectedValueOnce(new CreativeAgentClientError("连接中断，请重试", null)).mockResolvedValueOnce({});
    await render();
    await click("修改需求");
    expect(host.querySelector('button[type="submit"]')?.hasAttribute("disabled")).toBe(true);
    const feedback = host.querySelector('textarea[aria-label="修改要求"]') as HTMLTextAreaElement;
    expect(feedback).not.toBeNull();
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(feedback, "改成普通家庭真实客厅");
      feedback.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click("提交修改");
    expect(host.textContent).toContain("连接中断");
    expect(feedback.value).toBe("改成普通家庭真实客厅");
    expect(client.send).not.toHaveBeenCalled();
    vi.mocked(client.events).mockResolvedValue({ run: { ...run, status: "queued" }, events: [], nextSequence: 1 });
    await click("提交修改");
    expect(client.answer).toHaveBeenCalledTimes(2);
    const [first, second] = vi.mocked(client.answer).mock.calls;
    expect(first).toEqual(second);
    expect(first).toEqual(["revise-plan", expect.objectContaining({ proposalHash: "original-hash", answer: { revision: "改成普通家庭真实客厅" } })]);
    expect(host.querySelector('[aria-label="Agent 待确认事项"]')).toBeNull();
  });
  it("offers account skill choices and replaces the separate selection while preserving raw draft", async () => {
    await render();
    await fill("帮我制作短片");
    await click("技能指令");
    for (const name of ["workflow", "canvas", "storyflow"]) expect(document.body.textContent).toContain(name);
    await click("workflow");
    expect(sessionStorage.getItem("creative-agent:draft:v1:17:s")).toBe("帮我制作短片");
    expect(JSON.parse(sessionStorage.getItem("creative-agent:skill-intent:v1:17:s")!)).toBe("workflow");
    await click("技能指令");
    await click("storyflow");
    expect(sessionStorage.getItem("creative-agent:draft:v1:17:s")).toBe("帮我制作短片");
    expect(JSON.parse(sessionStorage.getItem("creative-agent:skill-intent:v1:17:s")!)).toBe("storyflow");
    expect(client.send).not.toHaveBeenCalled();
  });
  it("shows the context window and saved conversation tokens, cache hit and decode speed in the context popover", async () => {
    vi.mocked(client.session).mockResolvedValue({ ...blank, sessionId: "s", usage: { inputTokens: 607886, outputTokens: 23570, cachedInputTokens: 482662, reportedCalls: 3, missingCalls: 0, cacheHitPercent: 79.4, tokensPerSecond: 38.6, latestContextTokens: 12000 } });
    await render();
    const readsBefore=vi.mocked(client.session).mock.calls.length;
    await click("上下文与用量");
    expect(vi.mocked(client.session).mock.calls.length).toBeGreaterThan(readsBefore);
    const popup = host.querySelector('[role="dialog"][aria-label="上下文与用量"]')!;
    expect(popup.querySelector('[aria-label="上下文窗口"]')!.textContent).toContain("12k");
    expect(popup.textContent).toContain("608k");
    expect(popup.textContent).toContain("23.6k");
    expect(popup.textContent).toContain("缓存 79%");
    expect(popup.textContent).toContain("38.6 tok/s");
    expect(popup.querySelector('[title="607,886 tokens"]')).not.toBeNull();
  });
  it("keeps a newer equal-sequence title snapshot when an older usage refresh returns later", async () => {
    const {summarizeLlmAttempts}=await import("@/lib/creative-agent/call-metrics");
    const empty=summarizeLlmAttempts([]);
    const latest=summarizeLlmAttempts([{callId:"title",runId:"r",purpose:"title",providerId:"p",modelId:"m",status:"succeeded",timing:{startedAt:"s",dispatchedAt:"s"},usage:{inputTokens:73,outputTokens:9}}]);
    const snapshot=(allAttempts:any):CreativeAgentSessionSnapshot=>({...blank,sessionId:"s",latestSequence:7,usageScopes:{currentRun:empty,currentBranch:{inputTokens:0,outputTokens:0,cachedInputTokens:0,reportedCalls:0,missingCalls:0},allAttempts}});
    vi.mocked(client.session).mockResolvedValue(snapshot(empty));await render();
    let oldResolve!:(value:CreativeAgentSessionSnapshot)=>void,newResolve!:(value:CreativeAgentSessionSnapshot)=>void;
    vi.mocked(client.session).mockImplementationOnce(()=>new Promise(resolve=>{oldResolve=resolve;})).mockImplementationOnce(()=>new Promise(resolve=>{newResolve=resolve;}));
    // 每次打开自动刷新（关闭时不刷新）：打开 → 关闭 → 再打开，先后发出两次读取
    await click("上下文与用量");await click("上下文与用量");await click("上下文与用量");
    // 累计用量含自动标题：较新的快照先到、较旧的后到时，不能被旧数据覆盖
    await act(async()=>newResolve(snapshot(latest)));expect(host.querySelector('[aria-label="本次对话用量"]')?.textContent).toContain("73");
    await act(async()=>oldResolve(snapshot(empty)));expect(host.querySelector('[aria-label="本次对话用量"]')?.textContent).toContain("73");
  });
  it("keeps Chinese composition Enter, Shift+Enter, and board shortcuts inside the panel", async () => {
    await render();
    await fill("中文要求");
    const boardKey = vi.fn();
    document.addEventListener("keydown", boardKey);
    const textarea = host.querySelector<HTMLElement>('[aria-label="创作要求"]')!;
    await act(async () => {
      textarea.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          isComposing: true,
          bubbles: true,
          cancelable: true,
        }),
      );
      textarea.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          keyCode: 229,
          bubbles: true,
          cancelable: true,
        }),
      );
      textarea.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(client.send).not.toHaveBeenCalled();
    expect(boardKey).not.toHaveBeenCalled();
    document.removeEventListener("keydown", boardKey);
    await act(async () =>
      textarea.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    expect(client.send).toHaveBeenCalledTimes(1);
  });
  it("flushes once for a double submission and freezes the selected output and revision", async () => {
    let release!: (
      value: Awaited<ReturnType<CanvasAgentPanelProps["onPrepareMessage"]>>,
    ) => void;
    props.onPrepareMessage = vi.fn(
      () =>
        new Promise<
          Awaited<ReturnType<CanvasAgentPanelProps["onPrepareMessage"]>>
        >((resolve) => {
          release = resolve;
        }),
    );
    await render();
    await fill("@角色 创作");
    await act(async () => {
      const form = host.querySelector("form")!;
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
    });
    expect(props.onPrepareMessage).toHaveBeenCalledTimes(1);
    expect(client.send).not.toHaveBeenCalled();
    await act(async () =>
      release({ canvasId: 17, revision: "43", selection: props.selection }),
    );
    expect(client.send).toHaveBeenCalledTimes(1);
    expect(vi.mocked(client.send).mock.calls[0][1]).toMatchObject({
      baseRevision: "43",
      selection: { references: [{ nodeId: "n", outputId: "out1" }] },
    });
  });
  it("preserves draft when the canvas cannot save", async () => {
    props.onPrepareMessage = vi
      .fn()
      .mockRejectedValue(new Error("画布保存冲突"));
    await render();
    await fill("不要丢失");
    await click("发送创作要求");
    expect(client.send).not.toHaveBeenCalled();
    expect(host.querySelector('[aria-label="创作要求"]')!.textContent).toBe("不要丢失");
    expect(host.textContent).toContain("画布保存冲突");
  });
  it("retries an unknown submission with the same ID and frozen reference despite new selection", async () => {
    vi.mocked(client.send)
      .mockRejectedValueOnce(new CreativeAgentClientError("连接中断", null))
      .mockResolvedValueOnce({ sessionId: "s", runId: "r" });
    await render();
    await fill("使用角色");
    await click("发送创作要求");
    const first = vi.mocked(client.send).mock.calls[0][1];
    props = {
      ...props,
      selection: { nodeIds: ["other"], edgeIds: [], references: [] },
    };
    await render();
    await click("核对并重试");
    expect(client.send).toHaveBeenCalledTimes(2);
    expect(vi.mocked(client.send).mock.calls[1][1]).toEqual(first);
    expect(props.onPrepareMessage).toHaveBeenCalledTimes(1);
  });
  it("resolves receipt loss from persisted history without resubmitting", async () => {
    vi.mocked(client.send).mockRejectedValueOnce(
      new CreativeAgentClientError("连接中断", null),
    );
    await render();
    await fill("使用角色");
    await click("发送创作要求");
    const first = vi.mocked(client.send).mock.calls[0][1];
    vi.mocked(client.session).mockResolvedValue({
      sessionId: "s",
      messages: [
        {
          id: first.messageId,
          role: "user",
          text: first.text,
          createdAt: run.createdAt,
          runId: run.id,
        },
      ],
      run,
      latestSequence: 0,
    });
    await click("核对并重试");
    expect(client.send).toHaveBeenCalledTimes(1);
    expect(host.querySelector('[aria-label="创作要求"]')!.textContent).toBe("");
  });
  it("recovers tools and a completed message without duplicated delta text; refreshes actual canvas commit", async () => {
    vi.mocked(client.session).mockResolvedValue({
      sessionId: "s",
      messages: [
        {
          id: "m",
          role: "assistant",
          text: "已完成",
          createdAt: run.createdAt,
        },
      ],
      run,
      latestSequence: 4,
    });
    vi.mocked(client.events).mockResolvedValue({
      run: { ...run, status: "completed" },
      nextSequence: 4,
      events: [
        {
          sequence: 1,
          runId: "r",
          type: "text.delta",
          payload: { messageId: "m", delta: "已完成" },
          createdAt: run.createdAt,
        },
        {
          sequence: 2,
          runId: "r",
          type: "tool.started",
          payload: { actionId: "a", title: "写入画布" },
          createdAt: run.createdAt,
        },
        {
          sequence: 3,
          runId: "r",
          type: "tool.completed",
          payload: { actionId: "a", nodeIds: ["n"] },
          createdAt: run.createdAt,
        },
        {
          sequence: 4,
          runId: "r",
          type: "canvas.committed",
          payload: { revision: "44" },
          createdAt: run.createdAt,
        },
      ],
    });
    await render();
    expect(host.querySelector('[aria-label="Agent 消息"]')!.textContent).toBe(
      "已完成",
    );
    expect(props.onCanvasCommitted).toHaveBeenCalledTimes(1);
    await click("定位结果");
    expect(props.onLocateNode).toHaveBeenCalledWith("n");
  });
  it("renders an unmarked legacy tool error as incomplete and retains its actual detail", async () => {
    vi.mocked(client.session).mockResolvedValue({ ...blank, run });
    vi.mocked(client.events).mockResolvedValue({
      run: { ...run, status: "failed" },
      nextSequence: 2,
      events: [
        {
          sequence: 1,
          runId: "r",
          type: "tool.started",
          payload: { actionId: "a", title: "生成图片" },
          createdAt: run.createdAt,
        },
        {
          sequence: 2,
          runId: "r",
          type: "tool.completed",
          payload: {
            actionId: "a",
            status: "error",
            detail: "执行结果未确认，已暂停",
          },
          createdAt: run.createdAt,
        },
      ],
    });
    await render();
    const record = host.querySelector('[aria-label="创作操作"]')!;
    expect(record.textContent).toContain("操作未完成");
    expect(record.textContent).toContain("执行结果未确认，已暂停");
    expect(record.textContent).not.toContain("已完成");
    expect(record.querySelector("details")!.open).toBe(false);
    expect(host.querySelector('[role="alert"]')!.textContent).toContain("本轮未能完成");
  });
  it("shows actual reads and failures while keeping hidden thinking collapsed, decisions and reversible changes", async () => {
    const completed = { ...run, status: "completed" as const };
    const internalNames = ["project.read", "canvas.read", "history.read", "history.read", "media.inspect", "media.inspect", "media.inspect", "canvas.read", "media.inspect", "media.inspect", "generation.models", "model.guidance", "project.progress", "generation.read", "creative.method", "skillOperator", "artifact.review", "canvas.focus"];
    vi.mocked(client.session).mockResolvedValue({ ...blank, run: completed, messages: [
      { id: "thought", role: "assistant", text: "", thinking: { content: "内部思考内容" }, runId: "r", createdAt: run.createdAt },
      { id: "answer", role: "assistant", text: "图片已完成", thinking: { content: "回答前的思考" }, runId: "r", createdAt: run.createdAt },
    ] });
    vi.mocked(client.events).mockResolvedValue({ run: completed, nextSequence: 22, events: [
      ...internalNames.map((name, index) => ({ sequence: index + 1, runId: "r", type: "tool.completed" as const, createdAt: run.createdAt, payload: { actionId: `internal-${index}`, name, title: `内部步骤-${index}`, status: [6, 8].includes(index) ? "error" : "success", detail: "内部检查记录" } })),
      { sequence: 19, runId: "r", type: "tool.completed", createdAt: run.createdAt, payload: { actionId: "ask", name: "user.ask", title: "等待你的选择", detail: { decision: { title: "画幅确认", question: "选择比例", answer: "3:4" } } } },
      { sequence: 20, runId: "r", type: "tool.completed", createdAt: run.createdAt, payload: { actionId: "image", name: "image.generate", title: "生成图片" } },
      { sequence: 21, runId: "r", type: "tool.completed", createdAt: run.createdAt, payload: { actionId: "patch", name: "canvas.patch", title: "修改画布内容", nodeIds: ["n"], detail: { canUndo: true } } },
      { sequence: 22, runId: "r", type: "tool.completed", createdAt: run.createdAt, payload: { actionId: "unknown", name: "future.action", title: "新的创作操作" } },
    ] });
    await render();
    expect(host.textContent).not.toMatch(/内部思考内容|回答前的思考|思考记录|执行记录|等待你的选择/);
    expect(host.textContent).toContain("内部步骤-6操作未完成");
    expect(host.textContent).toContain("内部步骤-15已完成");
    expect(host.textContent).toContain("图片已完成");
    const thoughts = host.querySelectorAll('[aria-label="Agent 消息"] details');
    expect(thoughts).toHaveLength(1);
    expect(thoughts[0].textContent).toContain("思考过程");
    await act(async () => thoughts[0].querySelector("summary")!.click());
    expect(thoughts[0].textContent).toContain("内部思考内容");
    expect(thoughts[0].textContent).toContain("回答前的思考");
    const allSummaries = [...host.querySelectorAll('[aria-label="创作操作"] summary')];
    expect(allSummaries).toHaveLength(22);
    const summaries = allSummaries.slice(-4);
    expect(summaries.map(item => item.textContent)).toEqual(["已询问", "生成图片已完成", "修改画布内容已完成", "新的创作操作已完成"]);
    expect([...host.querySelectorAll('[aria-label="创作操作"] details')].every(item => !(item as HTMLDetailsElement).open)).toBe(true);
    const decision = summaries[0].parentElement as HTMLDetailsElement;
    await act(async () => (summaries[0] as HTMLElement).click());
    expect(decision.open).toBe(true);
    expect(decision.textContent).toContain("3:4");
    const modification = summaries[2].parentElement as HTMLDetailsElement;
    await act(async () => (summaries[2] as HTMLElement).click());
    expect(modification.open).toBe(true);
    expect(modification.querySelector("button")!.textContent).toContain("撤销此次画布修改");
    await click("定位结果");
    expect(props.onLocateNode).toHaveBeenCalledWith("n");
  });
  it("keeps a progress indicator while only internal preparation and thinking are running", async () => {
    vi.useFakeTimers();
    vi.mocked(client.session).mockResolvedValue({ ...blank, run });
    vi.mocked(client.events).mockResolvedValue({ run, nextSequence: 2, events: [
      { sequence: 1, runId: "r", type: "tool.started", createdAt: run.createdAt, payload: { actionId: "read", name: "canvas.read", title: "读取画布" } },
      { sequence: 2, runId: "r", type: "thinking.delta", createdAt: run.createdAt, payload: { messageId: "thinking", delta: "内部思考" } },
    ] });
    await render();
    expect(host.querySelector('[aria-label="创作操作"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="Agent 消息"]')).not.toBeNull();
    expect(host.textContent).toContain("思考中...");
    expect(host.textContent).toContain("读取画布");
    expect(host.textContent).not.toContain("内部思考");
    const thinking = host.querySelector('[aria-label="Agent 消息"] details') as HTMLDetailsElement;
    expect(thinking.open).toBe(false);
    await act(async () => thinking.querySelector("summary")!.click());
    await act(async () => vi.advanceTimersByTimeAsync(60));
    expect(thinking.open).toBe(true);
    expect(thinking.textContent).toContain("内部思考");
    expect([...host.querySelectorAll('[role="status"]')].some(item => item.textContent?.includes("正在查看画布素材"))).toBe(true);
    expect(host.querySelector('[aria-label="停止生成"]')).not.toBeNull();
  });
  it("keeps thinking separated by real reads while preserving the preceding reply", async () => {
    vi.useFakeTimers();
    const completed = { ...run, status: "completed" as const };
    const at = (second: number) => `2026-01-01T00:00:${String(second).padStart(2, "0")}.000Z`;
    const thoughts = Array.from({ length: 11 }, (_, index) => ({ id: `thought-${index}`, role: "assistant" as const, text: "", thinking: { content: `准备阶段 ${index + 1}`, duration: 2 }, runId: "r", createdAt: at(index * 2 + 2) }));
    vi.mocked(client.session).mockResolvedValue({ ...blank, run: completed, messages: [
      { id: "intro", role: "assistant", text: "已读取画布素材，继续整理方案。", thinking: { content: "确认本次目标", duration: 3 }, runId: "r", createdAt: at(0) },
      ...thoughts,
    ] });
    vi.mocked(client.events).mockResolvedValue({ run: completed, nextSequence: 10, events: thoughts.slice(0, 10).map((_, index) => ({ sequence: index + 1, runId: "r", type: "tool.completed", createdAt: at(index * 2 + 3), payload: { actionId: `read-${index}`, name: "media.inspect", title: "读取素材" } })) });
    await render();
    await act(async () => vi.advanceTimersByTimeAsync(150));
    const sections = host.querySelectorAll('[aria-label="Agent 消息"] details');
    expect(sections).toHaveLength(12);
    expect(sections[1].querySelector("summary")?.textContent).toContain("2.0 秒");
    expect((sections[1] as HTMLDetailsElement).open).toBe(false);
    expect(host.textContent).toContain("已读取画布素材，继续整理方案。");
    expect(host.textContent).not.toContain("准备阶段");
    await act(async () => sections[1].querySelector("summary")!.click());
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(sections[1].querySelectorAll("p")).toHaveLength(1);
    expect(sections[1].textContent).toContain(thoughts[0].thinking.content);
    expect([...host.querySelectorAll('[aria-label="创作操作"] details')].filter(item => !item.closest('[aria-label="Agent 消息"]'))).toHaveLength(10);
    expect(host.querySelectorAll('[aria-label="本轮回复操作"]')).toHaveLength(1);
  });
  it("keeps the same expanded thinking group as new streamed phases arrive", async () => {
    vi.useFakeTimers();
    vi.mocked(client.session).mockResolvedValue({ ...blank, run, messages: [{ id: "first", role: "assistant", text: "", thinking: { content: "准备阶段", duration: 2 }, runId: "r", createdAt: run.createdAt }] });
    vi.mocked(client.events).mockResolvedValue({ run, nextSequence: 1, events: [
      { sequence: 1, runId: "r", type: "thinking.delta", createdAt: run.createdAt, payload: { messageId: "second", delta: "核对资料", duration: 1 } },
    ] });
    await render();
    const section = host.querySelector('[aria-label="Agent 消息"] details') as HTMLDetailsElement;
    expect(host.querySelectorAll('[aria-label="Agent 消息"] details')).toHaveLength(1);
    expect(section.querySelector("summary")?.textContent).toContain("思考中...");
    await act(async () => section.querySelector("summary")!.click());
    expect(section.open).toBe(true);
    vi.mocked(client.events).mockResolvedValue({ run, nextSequence: 3, events: [
      { sequence: 2, runId: "r", type: "thinking.completed", createdAt: run.createdAt, payload: { messageId: "second", content: "核对资料完成", duration: 3 } },
      { sequence: 3, runId: "r", type: "thinking.delta", createdAt: run.createdAt, payload: { messageId: "third", delta: "整理方案", duration: 1 } },
    ] });
    await act(async () => vi.advanceTimersByTimeAsync(150));
    await act(async () => vi.advanceTimersByTimeAsync(50));
    expect(host.querySelectorAll('[aria-label="Agent 消息"] details')).toHaveLength(1);
    expect(host.querySelector('[aria-label="Agent 消息"] details')).toBe(section);
    expect(section.open).toBe(true);
    expect(section.querySelector("summary")?.textContent).toContain("6.0 秒");
    expect(section.textContent).toContain("准备阶段");
    expect(section.textContent).toContain("核对资料完成");
    expect(section.textContent).toContain("整理方案");
  });
  it("sends one stop request; closing the panel never stops the backend", async () => {
    props.onRunningChange = vi.fn();
    vi.mocked(client.session).mockResolvedValue({ ...blank, run });
    await render();
    expect(props.onRunningChange).toHaveBeenLastCalledWith(true);
    expect(host.querySelector('[aria-label="当前创作进度"] svg')?.getAttribute("data-state")).toBe("thinking");
    await act(async () => {
      const stop = [...host.querySelectorAll("button")].find(
        (button) => button.getAttribute("aria-label") === "停止生成",
      )!;
      stop.click();
      stop.click();
    });
    expect(client.control).toHaveBeenCalledTimes(1);
    expect(vi.mocked(client.control).mock.calls[0][1].action).toBe("stop");
    await click("关闭 Agent 面板");
    expect(props.onClose).toHaveBeenCalledTimes(1);
    expect(client.control).toHaveBeenCalledTimes(1);
    props.visible = false;
    await render();
    expect(props.onRunningChange).toHaveBeenLastCalledWith(true);
  });
  it("手动停止后发送键变成“继续执行”，点击从停下的地方继续；不显示单独的重新执行按钮", async () => {
    props.selection = { nodeIds: [], edgeIds: [], references: [] };
    const stopped = { ...run, status: "stopped" as const };
    const messages = [{ id: "u-stop", role: "user" as const, text: "做一张海报", runId: run.id, createdAt: run.createdAt }];
    vi.mocked(client.session).mockResolvedValue({ ...blank, sessionId: "s", run: stopped, messages, editableMessageId: "u-stop" });
    vi.mocked(client.events).mockResolvedValue({ run: stopped, events: [], nextSequence: 0, editableMessageId: "u-stop" });
    vi.mocked(client.control).mockResolvedValue({ run: { ...run, status: "queued" } });
    await render();
    expect(host.textContent).not.toContain("重新执行");
    const resume = host.querySelector<HTMLButtonElement>('[aria-label="继续执行"]')!;
    expect(resume).not.toBeNull();
    await act(async () => resume.click());
    expect(client.control).toHaveBeenCalledTimes(1);
    expect(vi.mocked(client.control).mock.calls[0][1].action).toBe("continue");
  });
  it("自己失败的一轮不显示继续键，提示用提问上的修改重新提交", async () => {
    const failed = { ...run, status: "failed" as const };
    const messages = [{ id: "u-fail", role: "user" as const, text: "做一张海报", runId: run.id, createdAt: run.createdAt }];
    vi.mocked(client.session).mockResolvedValue({ ...blank, sessionId: "s", run: failed, messages, editableMessageId: "u-fail" });
    vi.mocked(client.events).mockResolvedValue({ run: failed, events: [], nextSequence: 0, editableMessageId: "u-fail" });
    await render();
    expect(host.querySelector('[aria-label="继续执行"]')).toBeNull();
    expect(host.querySelector('[aria-label="编辑消息"]')).not.toBeNull();
    expect(host.querySelector('[role="alert"]')!.textContent).toContain("修改");
  });
  it("answers a specific proposal once and removes stale decisions rejected by server", async () => {
    vi.mocked(client.session).mockResolvedValue({
      ...blank,
      run: { ...run, status: "waiting_decision" },
    });
    vi.mocked(client.events).mockResolvedValue({
      run: { ...run, status: "waiting_decision" },
      nextSequence: 1,
      events: [
        {
          sequence: 1,
          runId: "r",
          type: "decision.requested",
          payload: {
            decisionId: "d",
            proposalHash: "hash",
            title: "确认生成",
            options: [{ value: "yes", label: "同意生成" }],
          },
          createdAt: run.createdAt,
        },
      ],
    });
    vi.mocked(client.answer).mockRejectedValue(
      new CreativeAgentClientError("方案已更新", 409),
    );
    await render();
    await act(async () => (host.querySelector('input[value="yes"]') as HTMLInputElement).click());
    await act(async () => {
      const button = host.querySelector('[aria-label="询问问题"] button[type="submit"]') as HTMLButtonElement;
      button.click(); button.click();
    });
    expect(client.answer).toHaveBeenCalledTimes(1);
    expect(vi.mocked(client.answer).mock.calls[0]).toEqual([
      "d",
      expect.objectContaining({ proposalHash: "hash", answer: "yes" }),
    ]);
    expect(host.querySelector('[aria-label="Agent 待确认事项"]')).toBeNull();
  });
  it("reads events from the last sequence, ignores repeated deltas, and cancels polling on unmount", async () => {
    vi.useFakeTimers();
    vi.mocked(client.session).mockResolvedValue({ ...blank, run });
    const delta = {
      sequence: 1,
      runId: "r",
      type: "text.delta" as const,
      payload: { messageId: "m", delta: "一" },
      createdAt: run.createdAt,
    };
    vi.mocked(client.events)
      .mockResolvedValueOnce({ run, events: [delta], nextSequence: 1 })
      .mockResolvedValue({
        run,
        events: [
          delta,
          { ...delta, sequence: 2, payload: { messageId: "m", delta: "二" } },
        ],
        nextSequence: 2,
      });
    await render();
    await act(async () => vi.advanceTimersByTimeAsync(1200));
    expect(vi.mocked(client.events).mock.calls[1][1]).toBe(1);
    await act(async () => vi.advanceTimersByTimeAsync(50));
    expect(host.querySelector('[aria-label="Agent 消息"]')!.textContent).toBe(
      "一二",
    );
    const beforeUnmount = vi.mocked(client.events).mock.calls.length;
    await act(async () => root.unmount());
    await act(async () => vi.advanceTimersByTimeAsync(5000));
    expect(client.events).toHaveBeenCalledTimes(beforeUnmount);
    expect(client.control).not.toHaveBeenCalled();
    root = createRoot(host);
  });
  it("protects composition boundary Enter and Escape without closing or sending", async () => {
    await render();
    await fill("中文");
    const now = vi.spyOn(Date, "now").mockReturnValue(1000);
    const textarea = host.querySelector<HTMLElement>('[aria-label="创作要求"]')!;
    await act(async () => {
      textarea.dispatchEvent(
        new CompositionEvent("compositionstart", { bubbles: true }),
      );
      textarea.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
      textarea.dispatchEvent(
        new CompositionEvent("compositionend", { bubbles: true }),
      );
      textarea.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });
    expect(props.onClose).not.toHaveBeenCalled();
    expect(client.send).not.toHaveBeenCalled();
    now.mockReturnValue(1100);
    await act(async () =>
      textarea.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      ),
    );
    expect(client.send).toHaveBeenCalledTimes(1);
  });
  it.each(["running", "paused", "stopping"] as const)("keeps only the composer stop control while %s", async status => {
    const current = { ...run, status };
    vi.mocked(client.session).mockResolvedValue({ ...blank, run: current });
    vi.mocked(client.events).mockResolvedValue({ run: current, events: [], nextSequence: 0 });
    await render();
    expect(host.querySelector('[aria-label="当前创作进度"] button')).toBeNull();
    const controls = host.querySelectorAll<HTMLButtonElement>('[aria-label="停止生成"]');
    expect(controls).toHaveLength(1);
    expect(controls[0].closest('form')).not.toBeNull();
    expect(controls[0].disabled).toBe(status === "stopping");
  });
  it("retains draft while offline and allows sending after reconnect", async () => {
    await render();
    await fill("离线草稿");
    await act(async () => window.dispatchEvent(new Event("offline")));
    expect(host.textContent).toContain("当前离线");
    await click("发送创作要求");
    expect(client.send).not.toHaveBeenCalled();
    expect(host.querySelector('[aria-label="创作要求"]')!.textContent).toBe("离线草稿");
    await act(async () => window.dispatchEvent(new Event("online")));
    await click("发送创作要求");
    expect(client.send).toHaveBeenCalledTimes(1);
  });
  it("keeps an uncertain message ID after closing and reopening the panel", async () => {
    vi.mocked(client.send).mockRejectedValueOnce(
      new CreativeAgentClientError("连接中断", null),
    );
    await render();
    await fill("保留编号");
    await click("发送创作要求");
    const input = vi.mocked(client.send).mock.calls[0][1];
    await act(async () => root.unmount());
    root = createRoot(host);
    await render();
    expect(host.querySelector('[aria-label="创作要求"]')!.textContent).toBe("保留编号");
    await click("核对并重试");
    expect(vi.mocked(client.send).mock.calls[1][1]).toEqual(input);
  });
  it("does not discard an uncertain send when receipt lookup loses authorization", async () => {
    vi.mocked(client.send).mockRejectedValueOnce(
      new CreativeAgentClientError("连接中断", null),
    );
    await render();
    await fill("原请求");
    await click("发送创作要求");
    const original = vi.mocked(client.send).mock.calls[0][1];
    vi.mocked(client.session).mockRejectedValueOnce(
      new CreativeAgentClientError("请重新登录", 401),
    );
    await click("核对并重试");
    expect(host.querySelector('[aria-label="创作要求"]')!.getAttribute("contenteditable")).toBe("false");
    await click("核对并重试");
    expect(vi.mocked(client.send).mock.calls[1][1]).toEqual(original);
  });
  it("drains terminal event batches before sending a new round and preserves trailing commits/tools", async () => {
    vi.useFakeTimers();
    const completed = { ...run, status: "completed" as const };
    vi.mocked(client.session).mockResolvedValue({
      ...blank,
      run: completed,
      latestSequence: 502,
    });
    const firstBatch = Array.from({ length: 500 }, (_, index) => ({
      sequence: index + 1,
      runId: "r",
      type: "tool.started" as const,
      payload: { actionId: "action", title: "写入画布" },
      createdAt: run.createdAt,
    }));
    vi.mocked(client.events)
      .mockResolvedValueOnce({
        run: completed,
        events: firstBatch,
        nextSequence: 500,
      })
      .mockResolvedValueOnce({
        run: completed,
        events: [
          {
            sequence: 501,
            runId: "r",
            type: "tool.completed",
            payload: { actionId: "action", nodeIds: ["last-node"] },
            createdAt: run.createdAt,
          },
          {
            sequence: 502,
            runId: "r",
            type: "canvas.committed",
            payload: { revision: "44" },
            createdAt: run.createdAt,
          },
        ],
        nextSequence: 502,
      })
      .mockResolvedValue({ run: completed, events: [], nextSequence: 502 });
    await render();
    await fill("下一轮");
    expect(
      (host.querySelector('[aria-label="发送创作要求"]') as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(props.onCanvasCommitted).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTimeAsync(200));
    expect(vi.mocked(client.events).mock.calls.map((call) => call[1])).toEqual([
      0, 500, 502,
    ]);
    expect(props.onCanvasCommitted).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain("已完成");
    expect(
      (host.querySelector('[aria-label="发送创作要求"]') as HTMLButtonElement)
        .disabled,
    ).toBe(false);
    await click("定位结果");
    expect(props.onLocateNode).toHaveBeenCalledWith("last-node");
    await act(async () => vi.advanceTimersByTimeAsync(5000));
    expect(client.events).toHaveBeenCalledTimes(3);
  });
  it("keeps partial attempts across 500-event pages until the terminal log is fully drained", async () => {
    vi.useFakeTimers();
    const completed = { ...run, status: "completed" as const };
    vi.mocked(client.session).mockResolvedValue({
      ...blank,
      run: completed,
      messages: [
        {
          id: "user",
          role: "user",
          runId: "r",
          text: "保留用户要求",
          createdAt: run.createdAt,
        },
      ],
    });
    const old = {
      sequence: 1,
      runId: "r",
      type: "text.delta" as const,
      payload: { messageId: "r:a:1:1", delta: "相同正文" },
      createdAt: run.createdAt,
    };
    const current = {
      ...old,
      sequence: 2,
      payload: { messageId: "r:a:2:1", delta: "相同正文" },
    };
    const firstPage = [
      old,
      current,
      ...Array.from({ length: 498 }, (_, index) => ({
        sequence: index + 3,
        runId: "r",
        type: "tool.started" as const,
        payload: { actionId: "a", title: "读取画布" },
        createdAt: run.createdAt,
      })),
    ];
    let resolveSecond!: (
      value: Awaited<ReturnType<typeof client.events>>,
    ) => void;
    let resolveEmpty!: (
      value: Awaited<ReturnType<typeof client.events>>,
    ) => void;
    vi.mocked(client.events)
      .mockResolvedValueOnce({
        run: completed,
        events: firstPage,
        nextSequence: 500,
      })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveSecond = resolve;
          }),
      )
      .mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveEmpty = resolve;
          }),
      );
    await render();
    expect(host.querySelectorAll('[aria-label="Agent 消息"]')).toHaveLength(2);
    await act(async () => vi.advanceTimersByTimeAsync(100));
    expect(host.querySelectorAll('[aria-label="Agent 消息"]')).toHaveLength(2);
    await act(async () =>
      resolveSecond({
        run: completed,
        nextSequence: 501,
        events: [
          {
            sequence: 501,
            runId: "r",
            type: "message.completed",
            payload: {
              message: { id: "r:a:2:1", role: "assistant", text: "相同正文" },
            },
            createdAt: run.createdAt,
          },
        ],
      }),
    );
    expect(host.querySelectorAll('[aria-label="Agent 消息"]')).toHaveLength(2);
    await act(async () => vi.advanceTimersByTimeAsync(200));
    await act(async () =>
      resolveEmpty({ run: completed, nextSequence: 501, events: [] }),
    );
    expect(vi.mocked(client.events).mock.calls.map((call) => call[1])).toEqual([
      0, 500, 501,
    ]);
    expect(host.querySelectorAll('[aria-label="Agent 消息"]')).toHaveLength(1);
    expect(host.querySelector('[aria-label="Agent 消息"]')!.textContent).toBe(
      "相同正文",
    );
    expect(
      host.querySelector('[aria-label="你的消息"]')!.textContent,
    ).toContain("保留用户要求");
  });
  it("stops polling an empty terminal log after the current cursor is confirmed", async () => {
    vi.useFakeTimers();
    const completed = { ...run, status: "completed" as const };
    vi.mocked(client.session).mockResolvedValue({ ...blank, run: completed });
    vi.mocked(client.events).mockResolvedValue({
      run: completed,
      events: [],
      nextSequence: 0,
    });
    await render();
    await act(async () => vi.advanceTimersByTimeAsync(5000));
    expect(client.events).toHaveBeenCalledTimes(1);
    await fill("可以继续");
    expect(
      (host.querySelector('[aria-label="发送创作要求"]') as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });
  it("restores a compact media result even if the chat route is unavailable", async () => {
    vi.mocked(client.capabilities).mockResolvedValue({ enabled: true, ready: false, reason: "对话模型暂不可用", protocolVersion: 1 });
    const failed = { ...run, status: "failed" as const };
    const media = { generationId: 12, runId: run.id, status: "success", mediaType: "image" as const, model: "Nano banana Pro", nodeIds: ["result-node"], outputs: [{ url: "/uploads/result.png", width: 1728, height: 2304 }], createdAt: run.createdAt };
    vi.mocked(client.session).mockResolvedValue({ ...blank, sessionId: "s", run: failed, media: [media], messages: [
      { id: "plan", role: "assistant", text: "方案已经确定", runId: run.id, createdAt: run.createdAt },
      { id: "delivery", role: "assistant", text: "已生成，结果已同步到画布。", runId: run.id, createdAt: run.createdAt },
    ] });
    vi.mocked(client.events).mockResolvedValue({ events: [], nextSequence: 0, run: failed, media: [media], mediaPending: false });
    await render();
    // 结果卡只显示版本名与所用模型，不堆尺寸和模板按钮
    expect(host.querySelector('[aria-label="图片生成结果"]')?.textContent).toContain("Nano banana Pro");
    expect(host.querySelector('[aria-label="图片生成结果"]')?.textContent).not.toMatch(/1728 × 2304|生成后检查|继续检查|调整要求|换场景或角度|采用此图/);
    // 对话里用缩略图，不下载原图
    expect([...host.querySelectorAll("img")].map(image => image.getAttribute("src"))).toContain(`/api/thumb?src=${encodeURIComponent("/uploads/result.png")}&w=600`);
    const messages = host.querySelectorAll('[aria-label="Agent 消息"]');
    expect(messages[0].querySelector('[aria-label="复制消息"]')).toBeNull();
    expect(messages[1].querySelector('button')).toBeNull();
    expect(host.querySelector('[aria-label="图片生成结果"] a, [aria-label="图片生成结果"] [download]')).toBeNull();
    await click("定位图片 1 到画布"); expect(props.onLocateNode).toHaveBeenCalledWith("result-node");
    expect(client.send).not.toHaveBeenCalled();
  });
  it("keeps polling pending media after a failed chat without locking a new message", async () => {
    vi.useFakeTimers();
    const failed = { ...run, status: "failed" as const };
    vi.mocked(client.session).mockResolvedValue({ ...blank, run: failed, mediaPending: true });
    vi.mocked(client.events).mockResolvedValue({ run: failed, events: [], nextSequence: 0, mediaPending: true });
    await render(); await act(async () => vi.advanceTimersByTimeAsync(1500));
    expect(vi.mocked(client.events).mock.calls.length).toBeGreaterThan(1);
    await fill("新的要求");
    expect((host.querySelector('[aria-label="发送创作要求"]') as HTMLButtonElement).disabled).toBe(false);
  });
  it("disables submission and avoids session loading when feature is disabled", async () => {
    vi.mocked(client.capabilities).mockResolvedValue({
      enabled: false,
      ready: false,
      reason: "管理员尚未开启",
      protocolVersion: 1,
    });
    await render();
    expect(client.session).not.toHaveBeenCalled();
    expect((host.querySelector('[aria-label="发送创作要求"]') as HTMLButtonElement).disabled).toBe(true);
    expect(host.textContent).toContain("管理员尚未开启");
  });
});

it("places receipt-based final explanation after media and hides the old fixed completion message", async () => {
  vi.mocked(client.session).mockResolvedValue({ ...blank, sessionId: "s", run: { ...run, status: "completed" }, messages: [
    { id: "user", role: "user", text: "生成两张", runId: "r", createdAt: run.createdAt },
    { id: "plan", role: "assistant", text: "按参考图生成两张客厅场景。", runId: "r", createdAt: run.createdAt },
    { id: "r:media:completed", role: "assistant", text: "已生成，结果已同步到画布。", runId: "r", createdAt: run.createdAt },
  ], media: [
    { generationId: 1, runId: "r", status: "success", mediaType: "image", model: "test", nodeIds: ["out"], outputs: [{ url: "/uploads/out.png", nodeId: "out" }], createdAt: run.createdAt },
    { generationId: 2, runId: "r", status: "failed", mediaType: "image", model: "test", nodeIds: ["failed"], outputs: [], error: "任务超时", createdAt: run.createdAt },
  ] });
  await render();
  // 失败原因显示在对应的结果格上，不再拼接固定模板说明
  const gallery = host.querySelector('[aria-label="图片生成结果"]')!;
  expect(gallery.querySelectorAll("img")).toHaveLength(1);
  expect(gallery.textContent).toContain("任务超时");
  const plan = [...host.querySelectorAll('[aria-label="Agent 消息"]')].find(node => node.textContent?.includes("按参考图生成两张客厅场景。"))!;
  expect(plan.compareDocumentPosition(gallery) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(host.querySelector('[aria-label="本轮生成结果说明"]')).toBeNull();
  expect([...host.querySelectorAll('[aria-label="Agent 消息"]')].map(node => node.textContent).join("")).not.toContain("已生成，结果已同步到画布。");
});

it("shows real current-generation progress instead of a generic creating label", async () => {
  vi.mocked(client.session).mockResolvedValue({ ...blank, sessionId: "s", run: { ...run, status: "waiting_action" }, media: [
    { generationId: 1, runId: "r", status: "running", mediaType: "image", model: "test", nodeIds: ["pending"], outputs: [], createdAt: run.createdAt },
  ] });
  await render();
  expect(host.querySelector('[aria-label="当前创作进度"]')?.textContent).toContain("正在生成图片");
  expect(host.querySelector('[aria-label="当前创作进度"]')?.textContent).toContain("1 项进行中");
  expect(host.querySelector('[aria-label="本轮生成结果说明"]')).toBeNull();
});

it("places selected canvas material in the editable paragraph and removes it when the selection clears", async () => {
  props.onGetReferencePreview = () => ({ kind: "image", url: "/reference.png" });
  await render();
  const editor = () => host.querySelector<HTMLElement>('[aria-label="创作要求"]')!;
  expect(editor().querySelectorAll('p [data-asset-mention]')).toHaveLength(1);
  expect(editor().querySelector('[data-asset-mention]')?.textContent).toBe("角色");
  expect(host.querySelectorAll('[data-agent-editor] [data-asset-id]')).toHaveLength(1);
  // 素材标签后面不补空格，取消选中时也不残留空格
  expect(sessionStorage.getItem("creative-agent:draft:v1:17:s")).toBe("@角色");
  await fill("参考 @角色 制作场景");
  expect(editor().querySelectorAll('p [data-asset-mention]')).toHaveLength(1);
  expect(editor().textContent).toBe("参考 角色 制作场景");
  await render();
  expect(editor().querySelectorAll('[data-asset-mention]')).toHaveLength(1);
  props.selection = { nodeIds: [], edgeIds: [], references: [] };
  await render();
  expect(editor().querySelector('[data-asset-mention]')).toBeNull();
  expect(editor().textContent).toBe("参考 制作场景");
});

it("shows real thumbnails, inserts one inline reference, previews it, and removes it from the sent context", async () => {
  props.onGetReferencePreview = () => ({ kind: "image", url: "/reference.png" });
  vi.mocked(fetch).mockImplementation(async (url) => Response.json(String(url).includes("/project?") ? { candidates: props.selection.references } : chatCatalog));
  await render();
  await click("提及节点输出或素材");
  const menu = () => host.querySelector('[aria-label="提及输出与素材"]')!;
  expect(menu().querySelector('img[alt="角色"]')?.getAttribute("src")).toContain("reference.png");
  await act(async () => menu().querySelector<HTMLButtonElement>('[aria-label="角色"]')!.click());
  await act(async () => { await new Promise<void>(resolve => requestAnimationFrame(() => resolve())); });
  const editor = host.querySelector<HTMLElement>('[aria-label="创作要求"]')!;
  expect(editor.querySelectorAll('[data-asset-mention]')).toHaveLength(1);
  expect(host.querySelector('[aria-label="提及输出与素材"]')).toBeNull();
  expect(host.querySelectorAll('[data-agent-editor] [data-asset-id]')).toHaveLength(1);
  expect(editor.querySelector('[data-asset-mention] img')?.getAttribute("src")).toContain("reference.png");
  // 插入的素材标签后面不再跟一个空格
  expect([...editor.querySelector("p")!.childNodes].some(node => node.nodeType === Node.TEXT_NODE && node.textContent === " ")).toBe(false);
  await act(async () => editor.querySelector<HTMLElement>('[data-asset-mention]')!.click());
  const preview = host.querySelector('[aria-label="素材预览"]')!;
  expect(preview.querySelector("img")?.getAttribute("src")).toContain("reference.png");
  expect(preview.hasAttribute("aria-modal")).toBe(false);
  await click("移除引用 角色");
  expect(host.querySelector('[data-asset-id]')).toBeNull();
  await fill("继续创作"); await click("发送创作要求");
  expect(vi.mocked(client.send).mock.calls[0][1].selection.references).toEqual([]);
  expect(vi.mocked(client.send).mock.calls[0][1].selection.nodeIds).toEqual([]);
});

it("refreshes canvas reference thumbnails and entries while the mention panel stays open", async () => {
  props.onGetReferences = () => props.selection.references;
  props.onGetReferencePreview = () => ({ kind: "image", url: "/before.png" });
  await render(); await click("提及节点输出或素材");
  props.onGetReferences = () => [{ canvasId: 17, nodeId: "new", label: "最新素材", kind: "image" }];
  props.onGetReferencePreview = () => ({ kind: "image", url: "/after.png" });
  await render();
  const menu = host.querySelector('[aria-label="提及输出与素材"]')!;
  expect(menu.querySelector('[aria-label="角色"]')).toBeNull();
  expect(menu.querySelector('img[alt="最新素材"]')?.getAttribute("src")).toContain("after.png");
});

it("excludes an empty task from the picker, composer, and sent materials but retains its operation target", async () => {
  const empty = { canvasId: 17, nodeId: "task", kind: "imageTask", label: "空图片任务" };
  const image = props.selection.references[0];
  props.selection = { nodeIds: ["task"], edgeIds: [], references: [empty] };
  props.onGetReferences = () => [image, empty];
  props.onGetReferencePreview = reference => reference.nodeId === "task" ? undefined : { kind: "image", url: "/source.png" };
  await render(); await click("提及节点输出或素材"); await click("当前画布");
  const menu = host.querySelector('[aria-label="提及输出与素材"]')!;
  expect(menu.querySelector('[aria-label="空图片任务"]')).toBeNull();
  expect(menu.querySelector('img[alt="角色"]')?.getAttribute("src")).toContain("source.png");
  expect(host.querySelector('[data-agent-editor] [data-asset-id]')).toBeNull();
  await click("已选引用");
  expect(host.querySelector('[aria-label="提及输出与素材"]')?.querySelector('[aria-label="空图片任务"]')).toBeNull();
  await fill("为选中节点生成图片"); await click("发送创作要求");
  expect(vi.mocked(client.send).mock.calls[0][1].selection).toMatchObject({ nodeIds: ["task"], references: [] });
});

it("retains a pinned output when it disappears and requires explicit removal before sending", async () => {
  const task = { canvasId: 17, nodeId: "task", kind: "imageTask", label: "生成图片" };
  props.selection = { nodeIds: ["task"], edgeIds: [], references: [] };
  props.onGetReferences = () => props.selection.references;
  props.onGetReferencePreview = () => undefined;
  vi.mocked(fetch).mockImplementation(async url => Response.json(String(url).includes("/project?") ? { candidates: props.selection.references } : chatCatalog));
  await render(); await click("提及节点输出或素材"); await click("当前画布");
  expect(host.querySelector('[aria-label="生成图片"]')).toBeNull();
  props.selection = { ...props.selection, references: [{ ...task, batchId: "batch", outputId: "output" }] };
  props.onGetReferencePreview = () => ({ kind: "image", url: "/generated.png" });
  await render();
  const menu = host.querySelector('[aria-label="提及输出与素材"]')!;
  expect(menu.querySelector('img[alt="生成图片"]')?.getAttribute("src")).toContain("generated.png");
  await act(async () => menu.querySelector<HTMLButtonElement>('[aria-label="生成图片"]')!.click());
  await act(async () => { await new Promise<void>(resolve => requestAnimationFrame(() => resolve())); });
  expect(host.querySelector('[data-agent-editor] [data-asset-id="reference:task:batch:output"]')).not.toBeNull();
  props.selection = { ...props.selection, references: [] };
  props.onGetReferencePreview = () => undefined;
  await render();
  expect(host.querySelector('[data-agent-editor] [data-asset-id="reference:task:batch:output"]')).not.toBeNull();
  expect(host.textContent).toContain("生成图片：引用已失效");
  expect(host.querySelector<HTMLButtonElement>('[aria-label="发送创作要求"]')!.disabled).toBe(true);
  expect(client.send).not.toHaveBeenCalled();
  await click("移除失效引用 生成图片");
  await fill("继续处理选中节点"); await click("发送创作要求");
  expect(vi.mocked(client.send).mock.calls[0][1].selection).toMatchObject({ nodeIds: ["task"], references: [] });
});

it.each(["image", "imageTask"])("keeps mixed references intact when a pinned %s becomes unavailable", async kind => {
  const valid = props.selection.references[0];
  const selected = { canvasId: 17, nodeId: "removed", kind, label: "产品侧面", ...(kind === "imageTask" ? { batchId: "batch", outputId: "selected-output" } : {}) };
  let available = [valid, selected];
  props.selection = { nodeIds: [valid.nodeId], edgeIds: [], references: [valid] };
  props.onGetReferences = () => available;
  props.onGetReferencePreview = reference => available.some(item => item.nodeId === reference.nodeId) ? { kind: "image", url: `/${reference.nodeId}.png` } : undefined;
  vi.mocked(fetch).mockImplementation(async url => Response.json(String(url).includes("/project?") ? { candidates: available } : chatCatalog));
  await render(); await click("提及节点输出或素材"); await click("当前画布");
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="提及输出与素材"] [aria-label="产品侧面"]')!.click());
  await render();
  available = [valid]; await render();
  expect(host.querySelectorAll('[data-agent-editor] [data-asset-mention]')).toHaveLength(2);
  expect(host.textContent).toContain("产品侧面：引用已失效");
  expect(host.querySelector<HTMLButtonElement>('[aria-label="发送创作要求"]')!.disabled).toBe(true);
  await click("发送创作要求"); expect(client.send).not.toHaveBeenCalled();
  await click("移除失效引用 产品侧面");
  await fill("使用 @角色 继续创作"); await click("发送创作要求");
  expect(vi.mocked(client.send).mock.calls[0][1].selection.references).toEqual([valid]);
});

it("blocks sending if a pinned output disappears while the canvas is being flushed", async () => {
  const selected = { canvasId: 17, nodeId: "task", kind: "imageTask", label: "产品正面", batchId: "batch", outputId: "selected-output" };
  let available = [selected];
  props.selection = { nodeIds: [], edgeIds: [], references: [] };
  props.onGetReferences = () => available;
  props.onGetReferencePreview = () => available.length ? { kind: "image", url: "/selected.png" } : undefined;
  vi.mocked(fetch).mockImplementation(async url => Response.json(String(url).includes("/project?") ? { candidates: available } : chatCatalog));
  await render(); await click("提及节点输出或素材"); await click("当前画布");
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="提及输出与素材"] [aria-label="产品正面"]')!.click());
  await render(); await fill("使用 @产品正面 生成背景");
  props.onPrepareMessage = vi.fn(async () => { available = []; return { canvasId: 17, revision: "43", selection: props.selection }; });
  await render(); await click("发送创作要求");
  expect(client.send).not.toHaveBeenCalled();
  expect(host.textContent).toContain("产品正面");
  expect(host.textContent).toContain("引用已失效");
  expect(host.querySelector('[data-asset-id="reference:task:batch:selected-output"]')).not.toBeNull();
});

it("omits gallery reference buttons while retaining image navigation to the canvas", async () => {
  props.selection = { nodeIds: [], edgeIds: [], references: [] };
  vi.mocked(client.events).mockResolvedValue({ events: [], nextSequence: 0, run: { ...run, status: "completed" } });
  vi.mocked(client.session).mockResolvedValue({ ...blank, sessionId: "s", run: { ...run, status: "completed" },
    messages: [{ id: "answer", role: "assistant", runId: "r", text: "生成完成", createdAt: run.createdAt }],
    media: [{ generationId: 10, runId: "r", status: "success", mediaType: "image", model: "m", nodeIds: ["shared-task"], createdAt: run.createdAt, outputs: [11, 12].map(generationId => ({ url: `/${generationId}.png`, nodeId: "shared-task", generationId })) }],
  });
  await render();
  const gallery = host.querySelector('[aria-label="图片生成结果"]')!;
  expect(gallery.querySelectorAll("img")).toHaveLength(2);
  expect(gallery.querySelector('[aria-label^="引用"]')).toBeNull();
  await click("定位图片 2 到画布");
  // 点的是多图里的第 2 张：定位时带上它的序号，画布会显示/高亮这一张
  expect(props.onLocateNode).toHaveBeenCalledWith("shared-task", { outputIndex: 1 });
  expect(client.send).not.toHaveBeenCalled();
});

it("inserts library material once inline, retains upload status, and removes a deleted token from attachments", async () => {
  props.canvasId = 1704;
  localStorage.setItem(cacheKey(7, "s", 1704), JSON.stringify({ model: "deepseek::deepseek-flash", thinkingLevel: "default", media: {} }));
  vi.stubGlobal("URL", class extends URL { static revokeObjectURL = vi.fn(); });
  props.selection = { nodeIds: [], edgeIds: [], references: [] };
  props.onPrepareMessage = vi.fn(async () => ({ canvasId: 1704, revision: "42", selection: props.selection }));
  const material = { id: "chair", name: "椅子.png", folderId: null, kind: "image", mime: "image/png", size: 100, createdAt: "2026-10-15", fileName: "chair.png" };
  let finishUpload!: (response: Response) => void;
  vi.mocked(fetch).mockImplementation(async (url) => {
    if (String(url).endsWith("/attachments")) return new Promise<Response>(resolve => { finishUpload = resolve; });
    if (String(url) === "/api/canvas/materials") return Response.json({ success: true, library: { version: 1, folders: [], items: [material] } });
    return Response.json(chatCatalog);
  });
  await render(); await click("提及节点输出或素材"); await click("素材库");
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  await click("椅子.png，引用素材");
  await act(async () => { await new Promise<void>(resolve => requestAnimationFrame(() => resolve())); });
  expect(host.querySelectorAll('[data-agent-editor] [data-asset-id="material:chair"]')).toHaveLength(1);
  const send = () => host.querySelector<HTMLButtonElement>('[aria-label="发送创作要求"]')!;
  expect(send().disabled).toBe(true);
  await act(async () => finishUpload(Response.json({ attachment: { id: "server-chair", coverage: "图片" } })));
  expect(send().disabled).toBe(false);
  await fill("不再引用素材");
  expect(host.querySelector('[data-asset-id="material:chair"]')).toBeNull();
  await click("发送创作要求");
  expect(vi.mocked(client.send).mock.calls[0][1].attachments).toEqual([]);
});

it("names a failed attachment and its reason, then allows sending after successful reselection", async () => {
  props.canvasId = 1705;
  localStorage.setItem(cacheKey(7, "s", 1705), JSON.stringify({ model: "deepseek::deepseek-flash", thinkingLevel: "default", media: {} }));
  vi.stubGlobal("URL", class extends URL { static revokeObjectURL = vi.fn(); });
  props.selection = { nodeIds: [], edgeIds: [], references: [] };
  props.onPrepareMessage = vi.fn(async () => ({ canvasId: 1705, revision: "42", selection: props.selection }));
  const material = { id: "chair", name: "产品.png", folderId: null, kind: "image", mime: "image/png", size: 5_600_000, createdAt: "2026-10-15", fileName: "chair.png" };
  let fail = true;
  vi.mocked(fetch).mockImplementation(async url => {
    if (String(url).endsWith("/attachments")) return fail
      ? Response.json({ error: "素材不存在或无法读取" }, { status: 404 })
      : Response.json({ attachment: { id: "server-chair", coverage: "图片" } });
    if (String(url) === "/api/canvas/materials") return Response.json({ success: true, library: { version: 1, folders: [], items: [material] } });
    return Response.json(chatCatalog);
  });
  await render(); await fill("使用产品制作背景图");
  await click("提及节点输出或素材"); await click("素材库");
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  await click("产品.png，引用素材");
  await act(async () => { await new Promise<void>(resolve => requestAnimationFrame(() => resolve())); });
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("产品.png：素材不存在或无法读取");
  expect(host.querySelector<HTMLButtonElement>('[aria-label="发送创作要求"]')!.disabled).toBe(true);
  expect(client.send).not.toHaveBeenCalled();
  await act(async () => host.querySelector<HTMLElement>('[data-agent-editor] [data-asset-id="material:chair"]')!.click());
  await click("移除附件 产品.png");
  fail = false;
  await click("提及节点输出或素材"); await click("素材库"); await click("产品.png，引用素材");
  await act(async () => { await new Promise<void>(resolve => requestAnimationFrame(() => resolve())); });
  expect(host.querySelector('[role="alert"]')).toBeNull();
  expect(host.querySelector<HTMLButtonElement>('[aria-label="发送创作要求"]')!.disabled).toBe(false);
  await click("发送创作要求");
  expect(vi.mocked(client.send).mock.calls[0][1].attachments).toEqual([{ id: "server-chair" }]);
});

it('restores a partial plan result without treating its old completion-message ID as a finished turn',async()=>{
 const waiting={...run,status:'waiting_decision' as const};
 vi.mocked(client.session).mockResolvedValue(JSON.parse(JSON.stringify({...blank,sessionId:'s',run:waiting,mediaPending:false,messages:[
  {id:'user',role:'user',text:'准备三张图片',runId:'r',createdAt:run.createdAt},
  {id:'r:media:completed',role:'assistant',text:'本轮生成任务已结束：1项成功。',runId:'r',createdAt:run.createdAt},
 ],media:[{generationId:1,runId:'r',status:'success',mediaType:'image',model:'test',nodeIds:['out'],outputs:[{url:'/one.png',nodeId:'out'}],createdAt:run.createdAt}]})));
 vi.mocked(client.events).mockResolvedValue({run:waiting,events:[],nextSequence:0});
 await render();
 expect(host.querySelector('[aria-label="图片生成结果"]')!.querySelectorAll('img')).toHaveLength(1);expect(host.textContent).not.toContain('本轮生成任务已结束');
 expect(host.querySelector('[aria-label="本轮回复操作"]')).toBeNull();
});

it('R22 renders preparation rejection separately from provider failure after refresh',async()=>{
 const completed={...run,status:'completed' as const};const activity=[{run:completed,event:{sequence:1,runId:'r',createdAt:run.createdAt,type:'tool.completed' as const,payload:{actionId:'prep',name:'image.generate',title:'生成图片',status:'error',detail:{phase:'preflight',dispatched:false,code:'invalid_requirement_source',message:'数量来源不明确'}}}},{run:completed,event:{sequence:2,runId:'r',createdAt:run.createdAt,type:'tool.completed' as const,payload:{actionId:'provider',name:'image.generate',title:'生成图片',status:'error',detail:{status:'failed',generationId:12,message:'上游失败'}}}}];
 vi.mocked(client.session).mockResolvedValue({...blank,sessionId:'s',messages:[{id:'u22',role:'user',text:'背景图',runId:'r',createdAt:run.createdAt}],run:completed,activity,latestSequence:2});vi.mocked(client.events).mockResolvedValue({run:completed,nextSequence:2,events:activity.map(row=>row.event)});await render();const text=host.querySelector('[aria-label="创作操作"]')!.textContent;expect(text).toContain('准备图片生成');expect(text).toContain('未通过（未提交）');expect(text).toContain('数量来源不明确');expect(text).toContain('生成失败');expect(text).toContain('上游失败');
});

it("R26 distinguishes actual skill loading, main rereads and resources without hiding events or reordering messages", async () => {
  const completed = { ...run, status: "completed" as const };
  const main = { id: "personal:21", name: "家庭场景方法", revision: 5, primaryPath: "guide.md", path: "guide.md" };
  const events: import("@/lib/creative-agent/contracts").CreativeAgentEvent[] = [];
  const record = (id: string, result: Record<string, unknown>, origin: "input_expansion" | "tool_call", second: number, status = "success") => {
    const activity = creativeToolActivity("skillOperator", result, origin)!;
    const common = { actionId: id, name: "skillOperator", title: "读取技能资料", activity };
    events.push({ sequence: events.length + 1, runId: "r", createdAt: `2026-01-01T00:00:0${second}.000Z`, type: "tool.started", payload: { ...common, status: "running" } });
    events.push({ sequence: events.length + 1, runId: "r", createdAt: `2026-01-01T00:00:0${second}.100Z`, type: "tool.completed", payload: { ...common, status, detail: { ...creativeToolPresentation("skillOperator", { ...result, status }), activity } } });
  };
  record("skill-input:r:0", main, "input_expansion", 1);
  record("main-reread", main, "tool_call", 3);
  record("reference-failed", { ...main, path: "references/light.md", message: "光线资料版本冲突" }, "tool_call", 5, "error");
  record("reference-unknown", { ...main, revision: 6, path: "references/style.md", receiptState: "unknown", message: "读取结果待核实" }, "tool_call", 7, "error");
  const state = applyAgentEvents(emptyAgentState(), events, completed);
  expect(state.tools.map(tool => tool.id)).toEqual(["skill-input:r:0", "main-reread", "reference-failed", "reference-unknown"]);
  expect(state.tools[0].status).toBe("completed");
  expect(state.tools[2].status).toBe("failed");
  expect(state.tools[3].outcomeLabel).toBe("结果待核实");
  vi.mocked(client.session).mockResolvedValue({ ...blank, sessionId: "s", run: completed, messages: [
    { id: "u26", role: "user", text: "一张家庭背景图", runId: "r", createdAt: "2026-01-01T00:00:00Z" },
    { id: "a26", role: "assistant", text: "中间消息", runId: "r", createdAt: "2026-01-01T00:00:02Z" },
    { id: "b26", role: "assistant", text: "最终消息", runId: "r", createdAt: "2026-01-01T00:00:08Z" },
  ] });
  vi.mocked(client.events).mockResolvedValue({ run: completed, events, nextSequence: events.length });
  await render();
  const summaries = [...host.querySelectorAll('[aria-label="创作操作"] details > summary')].map(summary => summary.textContent || "");
  expect(summaries.filter(text => text.includes("已加载技能 · 家庭场景方法"))).toHaveLength(1);
  expect(summaries.filter(text => text.includes("读取主文件 · 家庭场景方法 / guide.md"))).toHaveLength(1);
  expect(summaries.filter(text => text.includes("读取技能资料 · references/light.md"))).toHaveLength(1);
  expect(summaries.filter(text => text.includes("读取技能资料 · references/style.md"))).toHaveLength(1);
  expect(host.textContent).toContain("版本 5");
  expect(host.textContent).toContain("版本 6");
  expect(host.textContent).toContain("光线资料版本冲突");
  expect(host.textContent).toContain("结果待核实");
  expect(host.textContent).not.toContain("全部成功");
  expect(host.textContent!.indexOf("已加载技能 ·")).toBeLessThan(host.textContent!.indexOf("中间消息"));
  expect(host.textContent!.indexOf("中间消息")).toBeLessThan(host.textContent!.indexOf("读取主文件 ·"));
  expect(host.textContent!.indexOf("读取技能资料 · references/style.md")).toBeLessThan(host.textContent!.indexOf("最终消息"));
});

it("renders exact sent references inside the user bubble with thumbnails and keeps raw copy/edit source", async () => {
  const references = ["1_80.png", "1_103 拷贝.png", "1_110 拷贝.png", "没有mention的很长素材名称".repeat(8)].map((label, index) => ({ canvasId: 17, nodeId: `original-${index}`, label, kind: "image", outputId: `out-${index}` }));
  const text = "@1_80.png @1_103 拷贝.png @1_110 拷贝.png 根据这三张图生成高端家庭背景 @ordinary";
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn(async () => {}) } });
  vi.mocked(client.session).mockResolvedValue({ ...blank, sessionId: "s", messages: [{ id: "sent", role: "user", text, selectedSkillId: "workflow", createdAt: "2026-10-16", references }] });
  props.onGetReferencePreview = vi.fn(reference => reference.nodeId === "original-3" ? undefined : ({ kind: "image" as const, url: `/uploads/${reference.nodeId}.png` }));
  await render();
  const buttons = [...host.querySelectorAll<HTMLButtonElement>('[aria-label^="定位引用："]')];
  expect(buttons).toHaveLength(4);
  expect(new Set(buttons.map(button => button.parentElement)).size).toBe(1);
  const bubble = buttons[0].parentElement!;
  expect(bubble.textContent).toContain("workflow");
  expect(bubble.textContent).not.toContain("@1_80.png");
  expect(bubble.textContent).toContain("@ordinary");
  expect(buttons[0].querySelector("img")?.getAttribute("alt")).toBe("1_80.png");
  await act(async () => buttons[1].click());
  expect(props.onLocateNode).toHaveBeenCalledWith("original-1");
  await click("复制消息");
  expect(navigator.clipboard.writeText).toHaveBeenCalledWith(text);
});


const selectedSkillSnapshot = (): CreativeAgentSessionSnapshot => ({
  ...blank, sessionId: "s",
  session: { id: "s", activeSkillId: "personal:21", title: "创作对话", titleSource: "auto", titleMessageId: null, lastMessageId: null, messageCount: 0, createdAt: run.createdAt, updatedAt: run.createdAt },
});
const composerSkill = () => host.querySelector('form [data-role-skill-mention][data-skill-id="personal:21"]');
const settleEditor = async () => act(async () => { await new Promise<void>(resolve => requestAnimationFrame(() => resolve())); });

it("does not put the conversation's committed skill back into the empty composer when reopening", async () => {
  auth.includeCanonicalSkill = true;
  props.selection = { nodeIds: [], edgeIds: [], references: [] };
  vi.mocked(client.session).mockResolvedValue(selectedSkillSnapshot());
  await render(); await settleEditor();
  // 技能只作用于选它的那条消息；对话沿用的技能由服务端记住，输入框不再常驻显示
  expect(composerSkill()).toBeNull();
  expect(sessionStorage.getItem("creative-agent:draft:v1:17:s")).toBeNull();
  expect(sessionStorage.getItem("creative-agent:skill-intent:v1:17:s")).toBeNull();
});

it.each(["canonical slash", "separate picker"])("clears the %s skill from the composer after send and after remount", async method => {
  auth.includeCanonicalSkill = true;
  props.selection = { nodeIds: [], edgeIds: [], references: [] };
  sessionStorage.setItem("creative-agent:draft:v1:17:s", method === "canonical slash" ? "/skill:personal:21 一张家庭背景图" : "一张家庭背景图");
  await render();
  if (method === "separate picker") { await click("技能指令"); await click("personal:21"); }
  await settleEditor(); expect(composerSkill()).not.toBeNull();
  await click("发送创作要求"); await settleEditor();
  expect(client.send).toHaveBeenCalledTimes(1);
  expect(sessionStorage.getItem("creative-agent:draft:v1:17:s")).toBe("");
  expect(composerSkill()).toBeNull();
  vi.mocked(client.session).mockResolvedValue(selectedSkillSnapshot());
  await act(async () => root.unmount()); root = createRoot(host);
  await render(); await settleEditor();
  expect(composerSkill()).toBeNull();
  expect(sessionStorage.getItem("creative-agent:skill-intent:v1:17:s")).toBeNull();
});
