import React from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { act } from "react-dom/test-utils";
import { describe, expect, it, vi } from "vitest";
import { ProviderLlmUsageTags } from "@/components/admin/ProviderLlmUsageTags";
import { ProviderModelUsageGroups } from "@/components/admin/ProviderModelUsageGroups";
import { ProviderModelsModal } from "@/components/admin/ProviderModelsModal";
import ProvidersPanel from "@/components/admin/ProvidersPanel";
import {
  canMutateAdminDraft,
  commitProviderAdminDraftState,
  confirmProviderModelSelection,
  createProviderLlmAdminController,
  guardAdminDraftMutation,
  mergeProviderAdminSnapshotCommit,
  removeProviderChatModel,
  requestProviderAdminProviderSave,
  requestProviderAdminProxySave,
  type AdminLlmScenarioView,
} from "@/lib/providers/admin-ui";
import { getProviderModelCapability } from "@/lib/providers/model-availability";
import { getBuiltinProviders } from "@/lib/providers/registry";

(globalThis as typeof globalThis & { React: typeof React }).React = React;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const scenarios: AdminLlmScenarioView[] = [
  {
    id: "canvas.chat",
    label: "画布对话",
    visual: false,
    configured: { providerId: "provider-b", modelId: "shared-model" },
    effective: { providerId: "provider-b", modelId: "shared-model", status: "ready" },
    candidates: [{ providerId: "provider-b", modelId: "shared-model", status: "ready" }],
  },
  {
    id: "image.role_prompt",
    label: "创作、批量技能",
    visual: true,
    configured: { providerId: "provider-b", modelId: "shared-model" },
    effective: { providerId: "provider-b", modelId: "shared-model", status: "ready" },
    candidates: [{ providerId: "provider-b", modelId: "shared-model", status: "ready" }],
  },
];

function textOf(node: React.ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (!React.isValidElement(node)) return "";
  return textOf((node.props as { children?: React.ReactNode }).children);
}

function elementsOf(node: React.ReactNode): React.ReactElement[] {
  if (Array.isArray(node)) return node.flatMap(elementsOf);
  if (!React.isValidElement(node)) return [];
  return [node, ...elementsOf((node.props as { children?: React.ReactNode }).children)];
}

function renderUsageGroups(
  savedChatModels: string[],
  imageModels: string[] = [],
  videoModels: string[] = [],
  providerId = "provider-b",
  chatModels = ["shared-model"],
  compact = false,
) {
  return renderToStaticMarkup(React.createElement(ProviderModelUsageGroups, {
    compact,
    providerId,
    imageModels,
    chatModels,
    videoModels,
    chatModelDraft: "",
    chatModelOptions: [],
    canManageChat: false,
    savedChatModels,
    scenarios,
    routeActions: {},
    routesDisabled: false,
    mutationsDisabled: false,
    onChatModelDraftChange: vi.fn(),
    onAddChatModel: vi.fn(),
    onActivateRoute: vi.fn(),
    onRemove: vi.fn(),
  }));
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

type SnapshotProvider = {
  id: string;
  name: string;
  baseUrl: string;
  egressMode: "direct" | "proxy";
  enabled: boolean;
  imageModels: string[];
  videoModels: string[];
  chatModels: string[];
  hasKey: boolean;
  keyPreview: string;
  keySource: "saved" | "env" | "none";
};

function snapshotProvider(id: string, overrides: Partial<SnapshotProvider> = {}): SnapshotProvider {
  return {
    id,
    name: `Provider ${id}`,
    baseUrl: `https://${id}.saved.example/v1`,
    egressMode: "direct",
    enabled: true,
    imageModels: [`${id}-image-saved`],
    videoModels: [`${id}-video-saved`],
    chatModels: [`${id}-chat-saved`],
    hasKey: true,
    keyPreview: "sk-***",
    keySource: "saved",
    ...overrides,
  };
}

function snapshotFingerprint({ hasKey, keyPreview, keySource, ...provider }: SnapshotProvider) {
  return JSON.stringify(provider);
}

type SnapshotOperation =
  | { kind: "refresh" }
  | { kind: "activation" }
  | { kind: "provider-save"; providerId: string }
  | { kind: "proxy-save" };

type PayloadDraftState = {
  providers: SnapshotProvider[];
  savedProviderFingerprints: Record<string, string>;
  keyDrafts: Record<string, string>;
  clearKeyDrafts: Record<string, boolean>;
  proxyUrlDraft: string;
};

function commitPayloadDraftSnapshot(
  state: PayloadDraftState,
  operation: SnapshotOperation,
  snapshotProviders: SnapshotProvider[],
) {
  const merged = mergeProviderAdminSnapshotCommit({
    operation,
    currentProviders: state.providers,
    snapshotProviders,
    savedProviderFingerprints: state.savedProviderFingerprints,
    keyDrafts: state.keyDrafts,
    clearKeyDrafts: state.clearKeyDrafts,
    proxyUrlDraft: state.proxyUrlDraft,
  });
  state.providers = merged.providers;
  state.savedProviderFingerprints = merged.savedProviderFingerprints;
  state.keyDrafts = merged.keyDrafts;
  state.clearKeyDrafts = merged.clearKeyDrafts;
  state.proxyUrlDraft = merged.proxyUrlDraft;
}

type TestController = ReturnType<typeof createProviderLlmAdminController>;

const createTestController = (options: Parameters<typeof createProviderLlmAdminController>[0]) => (
  createProviderLlmAdminController(options)
);

describe("provider LLM row behavior", () => {
  it("sends the clicked scenario and exact provider/model binding", () => {
    const onActivate = vi.fn();
    const tree = ProviderLlmUsageTags({
      providerId: "provider-b",
      modelId: "shared-model",
      scenarios: [{ ...scenarios[1], configured: null, effective: { status: "missing-binding" } }],
      disabled: false,
      actionByScenario: {},
      onActivate,
    });
    const button = elementsOf(tree).find((element) => (
      element.type === "button" && textOf(element).includes("创作、批量技能")
    ));

    expect(button).toBeDefined();
    (button?.props as { onClick: () => void }).onClick();
    expect(onActivate).toHaveBeenCalledWith("image.role_prompt", {
      providerId: "provider-b",
      modelId: "shared-model",
    });
  });

  it("disables the same scenario on every row while showing busy only on the owner row", () => {
    const sharedScenarios = [{
      ...scenarios[1],
      configured: null,
      effective: { status: "missing-binding" },
      candidates: [
        { providerId: "provider-a", modelId: "model-a", status: "ready" },
        { providerId: "provider-b", modelId: "model-b", status: "ready" },
      ],
    }];
    const actionByScenario = {
      "image.role_prompt": {
        kind: "busy" as const,
        providerId: "provider-a",
        modelId: "model-a",
      },
    };
    const ownerTree = ProviderLlmUsageTags({
      providerId: "provider-a",
      modelId: "model-a",
      scenarios: sharedScenarios,
      disabled: false,
      actionByScenario,
      onActivate: vi.fn(),
    });
    const otherTree = ProviderLlmUsageTags({
      providerId: "provider-b",
      modelId: "model-b",
      scenarios: sharedScenarios,
      disabled: false,
      actionByScenario,
      onActivate: vi.fn(),
    });
    const ownerButton = elementsOf(ownerTree).find((element) => element.type === "button");
    const otherButton = elementsOf(otherTree).find((element) => element.type === "button");
    const ownerHasSpinner = elementsOf(ownerButton).some((element) => (
      String((element.props as { className?: string }).className || "").includes("animate-spin")
    ));
    const otherHasSpinner = elementsOf(otherButton).some((element) => (
      String((element.props as { className?: string }).className || "").includes("animate-spin")
    ));

    expect((ownerButton?.props as { disabled?: boolean }).disabled).toBe(true);
    expect((otherButton?.props as { disabled?: boolean }).disabled).toBe(true);
    expect(ownerHasSpinner).toBe(true);
    expect(otherHasSpinner).toBe(false);
  });

  it("shows clickable usages before a new chat model is saved", () => {
    const unsaved = renderUsageGroups([]);
    const saved = renderUsageGroups(["shared-model"]);

    expect(unsaved).toContain("待保存");
    // 画布对话 is governed by 模型显示, so it is no longer offered as a per-model usage.
    expect(unsaved).not.toContain('title="画布对话"');
    expect(unsaved.match(/title="创作、批量技能"/g)).toHaveLength(1);
    expect(unsaved).not.toContain('title="当前不可用：');
    expect(saved).not.toContain('title="画布对话"');
    expect(saved.match(/title="创作、批量技能"/g)).toHaveLength(1);
    expect(saved).not.toMatch(/<span[^>]*>画布对话<\/span>/);
    expect(saved).not.toMatch(/<span[^>]*>创作、批量技能<\/span>/);
  });

  it("renders the unified page names for image and video usages", () => {
    const html = renderUsageGroups([], ["gpt-image-2"], ["gemini-omni-video"], "kie");

    expect(getProviderModelCapability("provider-b", "chat", "shared-model").usages).toEqual([]);
    expect(html).toContain("创作");
    expect(html).toContain("批量");
    expect(html).toContain("画布");
    expect(html).not.toContain("在线生图");
    expect(html).not.toContain("画布生图节点");
    expect(html).not.toContain("视频工具");
    expect(html).not.toContain("画布视频节点");
  });

  it("blocks the production removal callback for an active binding", () => {
    const onBlocked = vi.fn();
    const onRemove = vi.fn();

    const removed = removeProviderChatModel({
      scenarios,
      providerId: "provider-b",
      modelId: "shared-model",
      onBlocked,
      onRemove,
    });

    expect(removed).toBe(false);
    expect(onRemove).not.toHaveBeenCalled();
    expect(onBlocked).toHaveBeenCalledWith("该模型正在用于：画布对话、创作、批量技能；请先切换这些用途");
  });

  it("atomically blocks a bulk selection that removes an active chat model", () => {
    let providerModels = {
      image: ["image-old"],
      video: ["video-old"],
      chat: ["shared-model", "inactive-model"],
    };
    let error = "";
    const nextModels = {
      image: ["image-new"],
      video: ["video-new"],
      chat: ["inactive-model"],
    };

    const confirmed = confirmProviderModelSelection({
      scenarios,
      providerId: "provider-b",
      currentChatModels: providerModels.chat,
      nextChatModels: nextModels.chat,
      onBlocked: (message) => { error = message; },
      onConfirm: () => { providerModels = nextModels; },
    });

    expect(confirmed).toBe(false);
    expect(providerModels).toEqual({
      image: ["image-old"],
      video: ["video-old"],
      chat: ["shared-model", "inactive-model"],
    });
    expect(error).toBe("该模型正在用于：画布对话、创作、批量技能；请先切换这些用途");
  });

  it("allows a bulk selection to remove only inactive chat models", () => {
    let chatModels = ["shared-model", "inactive-model"];
    const onBlocked = vi.fn();

    const confirmed = confirmProviderModelSelection({
      scenarios,
      providerId: "provider-b",
      currentChatModels: chatModels,
      nextChatModels: ["shared-model"],
      onBlocked,
      onConfirm: () => { chatModels = ["shared-model"]; },
    });

    expect(confirmed).toBe(true);
    expect(chatModels).toEqual(["shared-model"]);
    expect(onBlocked).not.toHaveBeenCalled();
  });
});

type MountedProviderRow = ReturnType<typeof mountedProviderRow>;

function mountedProviderRow(id: string) {
  return {
    id,
    name: `Mounted ${id}`,
    protocol: "openai" as const,
    baseUrl: `https://${id}.example/v1`,
    envKeyName: "",
    egressMode: "direct" as const,
    allowLegacyFallback: false,
    llmProtocol: "openai-chat" as const,
    llmEndpointTemplate: "chat/completions",
    imageModels: [],
    videoModels: [],
    chatModels: [`${id}-chat`],
    modelProtocols: {},
    enabled: true,
    sortOrder: id === "provider-a" ? 0 : 1,
    hasKey: true,
    keyPreview: "sk-***",
    keySource: "saved" as const,
    builtin: true,
  };
}

type MountedPanelActionHandler = (body: Record<string, any>) => Response | Promise<Response>;

function mountedPanelHarness(options: {
  fetchModels?: MountedPanelActionHandler;
  test?: MountedPanelActionHandler;
  activate?: MountedPanelActionHandler;
  scenarios?: AdminLlmScenarioView[];
  providers?: MountedProviderRow[];
  failFirstPostSync?: boolean;
} = {}) {
  let providers: MountedProviderRow[] = options.providers
    ?? [mountedProviderRow("provider-a"), mountedProviderRow("provider-b")];
  let proxy: {
    overrideState: "inherit" | "configured" | "disabled";
    source: "none" | "database";
    preview: string | null;
    hasCredentials: boolean;
  } = { overrideState: "inherit", source: "none", preview: null, hasCredentials: false };
  let revision = 1;
  let failNextProviderRead = false;
  let providerReadCount = 0;
  let routeReadCount = 0;
  let modelFetchCount = 0;
  let lineTestCount = 0;
  let activationCount = 0;
  const posts: Array<Record<string, any>> = [];
  const actionOrder: string[] = [];
  const modelFetchBodies: Array<Record<string, any>> = [];
  const lineTestBodies: Array<Record<string, any>> = [];
  const snapshot = () => ({
    success: true,
    providers,
    proxy,
    proxyStatusByProviderId: Object.fromEntries(providers.map((provider) => [provider.id, "ready"])),
    revision: `revision-${revision}`,
  });
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === "/api/admin/providers/fetch-models") {
      const body = JSON.parse(String(init?.body || "{}")) as Record<string, any>;
      modelFetchCount += 1;
      modelFetchBodies.push(body);
      return options.fetchModels?.(body) ?? json({ ok: false, message: "fetch handler missing" }, 500);
    }
    if (url === "/api/admin/providers/test") {
      const body = JSON.parse(String(init?.body || "{}")) as Record<string, any>;
      lineTestCount += 1;
      lineTestBodies.push(body);
      return options.test?.(body) ?? json({ ok: false, message: "test handler missing" }, 500);
    }
    if (/^\/api\/admin\/llm-routes\/[^/]+\/activate$/.test(url)) {
      const body = JSON.parse(String(init?.body || "{}")) as Record<string, any>;
      activationCount += 1;
      actionOrder.push(`activation:${url.split("/").at(-2)}`);
      return options.activate?.(body) ?? json({ success: true });
    }
    if (url === "/api/admin/providers" && init?.method === "POST") {
      const body = JSON.parse(String(init.body || "{}")) as Record<string, any>;
      posts.push(body);
      actionOrder.push("provider-save");
      revision += 1;
      if (body.provider) {
        providers = providers.map((provider) => provider.id === body.provider.id
          ? {
            ...provider,
            ...body.provider,
            hasKey: body.provider.clearApiKey ? false : Boolean(body.provider.apiKey || provider.hasKey),
            keyPreview: body.provider.clearApiKey ? "" : provider.keyPreview,
            keySource: body.provider.clearApiKey ? "none" : provider.keySource,
          }
          : provider);
      }
      if (body.proxyAction?.action === "set") {
        proxy = { overrideState: "configured", source: "database", preview: "http://proxy.example:7890", hasCredentials: false };
      } else if (body.proxyAction?.action === "disable") {
        proxy = { overrideState: "disabled", source: "database", preview: null, hasCredentials: false };
      }
      if (posts.length === 1 && options.failFirstPostSync !== false) failNextProviderRead = true;
      return json(snapshot());
    }
    if (url === "/api/admin/providers") {
      providerReadCount += 1;
      if (failNextProviderRead) {
        failNextProviderRead = false;
        return json({ error: "snapshot unavailable" }, 503);
      }
      return json(snapshot());
    }
    if (url === "/api/admin/llm-routes") {
      routeReadCount += 1;
      return json({ success: true, scenarios: options.scenarios ?? [] });
    }
    throw new Error(`Unexpected mounted panel request: ${url}`);
  });

  return {
    fetchImpl,
    posts,
    actionOrder,
    modelFetchBodies,
    lineTestBodies,
    get providerReadCount() { return providerReadCount; },
    get routeReadCount() { return routeReadCount; },
    get modelFetchCount() { return modelFetchCount; },
    get lineTestCount() { return lineTestCount; },
    get activationCount() { return activationCount; },
  };
}

async function waitForMountedPanel(predicate: () => boolean) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await act(async () => new Promise<void>((resolve) => setTimeout(resolve, 0)));
  }
  throw new Error("Mounted provider panel did not reach the expected state");
}

function mountedButton(container: HTMLElement, label: string) {
  const button = Array.from(container.querySelectorAll("button"))
    .find((candidate) => candidate.textContent?.includes(label));
  if (!button) throw new Error(`Missing mounted button: ${label}`);
  return button;
}

function mountedProviderCard(container: HTMLElement, providerId: string) {
  const card = Array.from(container.querySelectorAll('section[aria-label="平台模型"] > div'))
    .find((candidate) => candidate.textContent?.includes(`Mounted ${providerId}`));
  if (!(card instanceof HTMLElement)) throw new Error(`Missing mounted provider card: ${providerId}`);
  return card;
}

function openSettings(card: HTMLElement) {
  act(() => flushSync(() => mountedButton(card, "平台设置").click()));
  return Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]')).find((dialog) => dialog.textContent?.includes("平台状态"))!;
}
function openProxy(container: HTMLElement) {
  act(() => flushSync(() => mountedButton(container, "统一代理").click()));
  const dialog = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]')).find((item) => item.textContent?.includes("代理模式"))!;
  act(() => flushSync(() => mountedButton(dialog, "自定义代理").click()));
  return dialog;
}
function closeSettings() {
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
  if (dialog) act(() => dialog.querySelector<HTMLButtonElement>('button[aria-label="关闭"]')?.click());
}

async function changeMountedInput(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function mountProviderPanel(fetchImpl: typeof fetch) {
  const previousFetch = globalThis.fetch;
  const previousConfirm = window.confirm;
  const previousScrollIntoView = HTMLElement.prototype.scrollIntoView;
  const previousGetContext = HTMLCanvasElement.prototype.getContext;
  globalThis.fetch = fetchImpl;
  window.confirm = () => true;
  HTMLElement.prototype.scrollIntoView = vi.fn();
  HTMLCanvasElement.prototype.getContext = vi.fn(() => null) as typeof HTMLCanvasElement.prototype.getContext;
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  let refreshSignal = 0;
  await act(async () => root.render(React.createElement(ProvidersPanel, { refreshSignal, active: true })));
  await waitForMountedPanel(() => container.textContent?.includes("Mounted provider-a") === true);
  return {
    container,
    refresh: (active = true) => root.render(React.createElement(ProvidersPanel, { refreshSignal: ++refreshSignal, active })),
    cleanup: async () => {
      await act(async () => root.unmount());
      container.remove();
      globalThis.fetch = previousFetch;
      window.confirm = previousConfirm;
      if (previousScrollIntoView) HTMLElement.prototype.scrollIntoView = previousScrollIntoView;
      else delete (HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView;
      HTMLCanvasElement.prototype.getContext = previousGetContext;
    },
  };
}

describe("built-in model removal protection", () => {
  it.each([false, true])("hides removal for every built-in chat model but keeps fetched additions removable (compact=%s)", compact => {
    for (const provider of getBuiltinProviders().filter(item => item.chatModels.length)) {
      const models = [...provider.chatModels, "fetched-extra-model"];
      const html = renderUsageGroups(models, [], [], provider.id, models, compact);
      for (const model of provider.chatModels) {
        expect(html).toContain(model);
        expect(html, `${provider.id}/${model}`).not.toContain(`aria-label="移除聊天模型 ${model}"`);
      }
      expect(html).toContain('aria-label="移除聊天模型 fetched-extra-model"');
    }
  });
  it("keeps integrated images visible without a remove action", () => {
    const html = renderUsageGroups([], ["gpt-image-2-apimart"], [], "apimart");
    expect(html).toContain("gpt-image-2-apimart");
    expect(html).not.toContain('aria-label="移除生图模型 gpt-image-2-apimart"');
  });
  it("keeps removal available for added chat models", () => {
    expect(renderUsageGroups(["shared-model"])).toContain('aria-label="移除聊天模型 shared-model"');
  });
});

describe("provider admin draft state mirrors", () => {
  it("publishes provider key draft removals to the ref before React state", () => {
    const keyDraftsRef: { current: Record<string, string> } = {
      current: { "provider-a": "committed-key", "provider-b": "other-key" },
    };
    const renderedStates: Array<Record<string, string>> = [];

    commitProviderAdminDraftState(keyDraftsRef, (next) => {
      expect(keyDraftsRef.current).toBe(next);
      renderedStates.push(next);
    }, (current) => Object.fromEntries(
      Object.entries(current).filter(([providerId]) => providerId !== "provider-a"),
    ));

    expect(keyDraftsRef.current).toEqual({ "provider-b": "other-key" });
    expect(renderedStates).toEqual([{ "provider-b": "other-key" }]);
  });

  it("publishes a committed proxy clear to the ref before React state", () => {
    const proxyUrlDraftRef = { current: "http://committed-proxy.example:7890" };
    let renderedState = proxyUrlDraftRef.current;

    commitProviderAdminDraftState(proxyUrlDraftRef, (next) => {
      expect(proxyUrlDraftRef.current).toBe(next);
      renderedState = next;
    }, () => "");

    expect(proxyUrlDraftRef.current).toBe("");
    expect(renderedState).toBe("");
  });
});

describe("provider model browser", () => {
  it("finds a provider by model name and preserves drafts across selection and top refresh", async () => {
    const harness = mountedPanelHarness({ failFirstPostSync: false });
    const mounted = await mountProviderPanel(harness.fetchImpl as typeof fetch);
    try {
      const a = mountedProviderCard(mounted.container, "provider-a");
      const b = mountedProviderCard(mounted.container, "provider-b");
      expect(a.hidden).toBe(false);
      expect(b.hidden).toBe(true);
      expect(document.querySelector('[role="dialog"]')).toBeNull();
      const key = openSettings(a).querySelector('input[type="password"]') as HTMLInputElement;
      await changeMountedInput(key, "unsaved-draft");
      closeSettings();
      const search = mounted.container.querySelector('[aria-label="搜索平台或模型"]') as HTMLInputElement;
      await changeMountedInput(search, "provider-b-chat");
      expect(a.hidden).toBe(true);
      expect(b.hidden).toBe(false);
      expect(mounted.container.querySelector('[aria-label="平台列表"]')?.textContent).not.toContain("Mounted provider-a");
      await changeMountedInput(search, "no-matching-model");
      expect(mounted.container.textContent).toContain("没有匹配的平台或模型");
      await changeMountedInput(search, "");
      const nav = mounted.container.querySelector('[aria-label="平台列表"]') as HTMLElement;
      await act(async () => mountedButton(nav, "Mounted provider-b").click());
      const reads = harness.providerReadCount;
      await act(async () => mounted.refresh());
      await waitForMountedPanel(() => harness.providerReadCount > reads);
      expect(b.hidden).toBe(false);
      expect((openSettings(a).querySelector('input[type="password"]') as HTMLInputElement).value).toBe("unsaved-draft");
      closeSettings();
      expect(harness.posts).toHaveLength(0);
      expect(harness.modelFetchCount).toBe(0);
      const updatedReads = harness.providerReadCount;
      await act(async () => mounted.refresh(false));
      expect(harness.providerReadCount).toBe(updatedReads);
    } finally { await mounted.cleanup(); }
  });
});

describe("mounted provider card actions", () => {
  it("visually dims the whole provider card and labels it when disabled", async () => {
    const harness = mountedPanelHarness({
      providers: [
        mountedProviderRow("provider-a"),
        { ...mountedProviderRow("provider-b"), enabled: false },
      ],
      failFirstPostSync: false,
    });
    const mounted = await mountProviderPanel(harness.fetchImpl as typeof fetch);
    try {
      const providerA = mountedProviderCard(mounted.container, "provider-a");
      const providerB = mountedProviderCard(mounted.container, "provider-b");

      expect(providerB.className).toContain("opacity-60");
      expect(providerB.textContent).toContain("已停用");
      expect(mountedButton(openSettings(providerB), "启用").disabled).toBe(false);
      expect(providerA.className).not.toContain("opacity-60");
      expect(providerA.textContent).not.toContain("已停用");
    } finally {
      await mounted.cleanup();
    }
  });

  it("blocks stopping a provider while an LLM usage is still bound", async () => {
    const mountedScenarios: AdminLlmScenarioView[] = [
      {
        id: "canvas.chat",
        label: "画布对话",
        visual: false,
        configured: { providerId: "provider-b", modelId: "provider-b-chat" },
        effective: { providerId: "provider-b", modelId: "provider-b-chat", status: "ready" },
        candidates: [
          { providerId: "provider-a", modelId: "provider-a-chat", status: "ready" },
          { providerId: "provider-b", modelId: "provider-b-chat", status: "ready" },
        ],
      },
      {
        id: "image.role_prompt",
        label: "创作、批量技能",
        visual: true,
        configured: { providerId: "provider-b", modelId: "provider-b-chat" },
        effective: { providerId: "provider-b", modelId: "provider-b-chat", status: "ready" },
        candidates: [
          { providerId: "provider-a", modelId: "provider-a-chat", status: "ready" },
          { providerId: "provider-b", modelId: "provider-b-chat", status: "ready" },
        ],
      },
    ];
    const harness = mountedPanelHarness({
      scenarios: mountedScenarios,
      providers: [mountedProviderRow("provider-a"), mountedProviderRow("provider-b")],
      failFirstPostSync: false,
    });
    const mounted = await mountProviderPanel(harness.fetchImpl as typeof fetch);
    try {
      const providerB = mountedProviderCard(mounted.container, "provider-b");
      await act(async () => {
        mountedButton(openSettings(providerB), "停用").click();
        await Promise.resolve();
      });
      await waitForMountedPanel(() => document.body.textContent?.includes("无法停用 Mounted provider-b") === true);

      expect(document.body.textContent).toContain("画布对话");
      expect(document.body.textContent).toContain("创作、批量技能");
      expect(providerB.className).not.toContain("opacity-60");
      expect(providerB.textContent).not.toContain("已停用");
      expect(mountedButton(openSettings(providerB), "停用").disabled).toBe(false);
      expect(mountedButton(providerB, "保存本平台").disabled).toBe(true);
      expect(harness.posts).toHaveLength(0);

      await act(async () => mountedButton(document.body, "知道了").click());
      await waitForMountedPanel(() => !document.body.textContent?.includes("无法停用 Mounted provider-b"));

      const providerA = mountedProviderCard(mounted.container, "provider-a");
      await act(async () => mountedButton(openSettings(providerA), "停用").click());
      await waitForMountedPanel(() => providerA.className.includes("opacity-60"));

      expect(providerA.textContent).toContain("已停用");
      expect(mountedButton(openSettings(providerA), "启用").disabled).toBe(false);
      expect(mountedButton(providerA, "保存本平台").disabled).toBe(false);
    } finally {
      await mounted.cleanup();
    }
  });

  it("places the sole provider save action in the card header", async () => {
    const harness = mountedPanelHarness({ failFirstPostSync: false });
    const mounted = await mountProviderPanel(harness.fetchImpl as typeof fetch);
    try {
      const providerA = mountedProviderCard(mounted.container, "provider-a");
      const saveButtons = Array.from(providerA.querySelectorAll("button")).filter((button) => (
        button.textContent?.includes("保存本平台")
      ));

      expect(saveButtons).toHaveLength(1);
      expect(providerA.firstElementChild?.contains(saveButtons[0])).toBe(true);
    } finally {
      await mounted.cleanup();
    }
  });

  it("switches an LLM usage without opening a confirmation dialog", async () => {
    const mountedScenarios: AdminLlmScenarioView[] = [{
      id: "image.role_prompt",
      label: "创作、批量技能",
      visual: true,
      configured: { providerId: "provider-b", modelId: "provider-b-chat" },
      effective: { providerId: "provider-b", modelId: "provider-b-chat", status: "ready" },
      candidates: [
        { providerId: "provider-a", modelId: "provider-a-chat", status: "ready" },
        { providerId: "provider-b", modelId: "provider-b-chat", status: "ready" },
      ],
    }];
    const harness = mountedPanelHarness({ scenarios: mountedScenarios });
    const mounted = await mountProviderPanel(harness.fetchImpl as typeof fetch);
    const confirmSpy = vi.fn(() => false);
    window.confirm = confirmSpy;
    try {
      const providerA = mountedProviderCard(mounted.container, "provider-a");
      act(() => mountedButton(providerA, "创作、批量技能").click());
      await waitForMountedPanel(() => harness.activationCount === 1);

      expect(confirmSpy).not.toHaveBeenCalled();
    } finally {
      await mounted.cleanup();
    }
  });

  it("opens a dismissible alternative-LLM dialog after activation failure and probes the selected replacement", async () => {
    const mountedScenarios: AdminLlmScenarioView[] = [{
      id: "image.role_prompt",
      label: "创作、批量技能",
      visual: true,
      configured: { providerId: "provider-a", modelId: "provider-a-chat" },
      effective: { providerId: "provider-a", modelId: "provider-a-chat", status: "ready" },
      candidates: [
        { providerId: "provider-a", modelId: "provider-a-chat", status: "ready" },
        { providerId: "provider-b", modelId: "provider-b-chat", status: "ready" },
        { providerId: "provider-c", modelId: "provider-c-chat", status: "ready" },
      ],
    }];
    const activations: Array<Record<string, any>> = [];
    const harness = mountedPanelHarness({
      scenarios: mountedScenarios,
      providers: [
        mountedProviderRow("provider-a"),
        mountedProviderRow("provider-b"),
        mountedProviderRow("provider-c"),
      ],
      activate: (body) => {
        activations.push(body);
        if (body.providerId === "provider-b") {
          return new Response(JSON.stringify({
            error: "LLM 服务额度不足，请充值或选择其他平台模型。",
          }), {
            status: 403,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    });
    const mounted = await mountProviderPanel(harness.fetchImpl as typeof fetch);
    try {
      const providerB = mountedProviderCard(mounted.container, "provider-b");
      await act(async () => {
        mountedButton(providerB, "创作、批量技能").click();
        await Promise.resolve();
      });
      await waitForMountedPanel(() => (
        document.body.textContent?.includes("未切换，原模型继续保留") === true
        && Array.from(document.body.querySelectorAll("button")).some((button) => button.textContent?.includes("暂不切换"))
      ));

      const firstDialog = mountedButton(document.body, "暂不切换").closest(".relative") as HTMLElement;
      expect(firstDialog.textContent).toContain("LLM 服务额度不足，请充值或选择其他平台模型。");
      expect(firstDialog.textContent).toContain("请选择其他平台的 LLM");
      expect(firstDialog.textContent).not.toContain("Mounted provider-a · provider-a-chat");
      expect(providerB.textContent).not.toContain("LLM 服务额度不足");
      expect(providerB.textContent).not.toContain("请选择其他平台的 LLM");

      await act(async () => {
        mountedButton(firstDialog, "暂不切换").click();
        await Promise.resolve();
      });
      await waitForMountedPanel(() => (
        Array.from(document.body.querySelectorAll("button")).every((button) => !button.textContent?.includes("暂不切换"))
      ));

      await act(async () => {
        mountedButton(providerB, "创作、批量技能").click();
        await Promise.resolve();
      });
      await waitForMountedPanel(() => (
        document.body.textContent?.includes("请选择其他平台的 LLM") === true
        && Array.from(document.body.querySelectorAll("button")).some((button) => button.textContent?.includes("暂不切换"))
      ));

      const secondDialog = mountedButton(document.body, "暂不切换").closest(".relative") as HTMLElement;
      await act(async () => {
        mountedButton(secondDialog, "Mounted provider-c · provider-c-chat").click();
        await Promise.resolve();
      });
      await waitForMountedPanel(() => harness.activationCount === 3);

      expect(activations).toEqual([
        { providerId: "provider-b", modelId: "provider-b-chat" },
        { providerId: "provider-b", modelId: "provider-b-chat" },
        { providerId: "provider-c", modelId: "provider-c-chat" },
      ]);
    } finally {
      await mounted.cleanup();
    }
  });
});

describe("mounted provider admin post-sync recovery", () => {
  it("clears committed provider key drafts before an immediate retry while preserving another provider draft", async () => {
    const harness = mountedPanelHarness();
    const mounted = await mountProviderPanel(harness.fetchImpl as typeof fetch);
    try {
      const providerA = mountedProviderCard(mounted.container, "provider-a");
      const providerB = mountedProviderCard(mounted.container, "provider-b");
      const keyA = openSettings(providerA).querySelector('input[type="password"]') as HTMLInputElement;
      await changeMountedInput(keyA, "committed-provider-key");
      const keyB = openSettings(providerB).querySelector('input[type="password"]') as HTMLInputElement;
      await changeMountedInput(keyB, "other-provider-draft");
      await act(async () => mountedButton(openSettings(providerA), "清除已保存 Key").click());

      let sawCommittedSyncFailure = false;
      let retryClicked = false;
      const observer = new MutationObserver(() => {
        if (!retryClicked && mounted.container.textContent?.includes("配置已保存，但配置同步失败，请刷新后再操作。")) {
          sawCommittedSyncFailure = true;
          retryClicked = true;
          mounted.refresh();
        }
      });
      observer.observe(mounted.container, { childList: true, subtree: true, characterData: true });

      act(() => mountedButton(providerA, "保存本平台").click());
      await waitForMountedPanel(() => harness.providerReadCount >= 3 && harness.routeReadCount >= 2);
      observer.disconnect();

      expect(sawCommittedSyncFailure).toBe(true);
      expect((openSettings(providerA).querySelector('input[type="password"]') as HTMLInputElement).value).toBe("");
      expect((openSettings(providerB).querySelector('input[type="password"]') as HTMLInputElement).value).toBe("other-provider-draft");
      expect((mountedButton(providerA, "保存本平台") as HTMLButtonElement).disabled).toBe(true);

      const baseUrlA = openSettings(providerA).querySelector('input:not([type="password"])') as HTMLInputElement;
      await changeMountedInput(baseUrlA, "https://provider-a.changed.example/v1");
      act(() => mountedButton(providerA, "保存本平台").click());
      await waitForMountedPanel(() => harness.posts.length >= 2 && harness.providerReadCount >= 4);
      expect(harness.posts[1].provider.apiKey).toBeUndefined();
      expect(harness.posts[1].provider.clearApiKey).toBe(false);
      expect((openSettings(providerB).querySelector('input[type="password"]') as HTMLInputElement).value).toBe("other-provider-draft");
    } finally {
      await mounted.cleanup();
    }
  });

  it("clears a committed proxy draft before an immediate retry while preserving provider drafts", async () => {
    const harness = mountedPanelHarness();
    const mounted = await mountProviderPanel(harness.fetchImpl as typeof fetch);
    try {
      const providerB = mountedProviderCard(mounted.container, "provider-b");
      const keyB = openSettings(providerB).querySelector('input[type="password"]') as HTMLInputElement;
      await changeMountedInput(keyB, "other-provider-draft");
      const proxyInput = openProxy(mounted.container).querySelector('[aria-label="统一代理 URL"]') as HTMLInputElement;
      await changeMountedInput(proxyInput, "http://old-proxy.example:7890");

      let sawCommittedSyncFailure = false;
      let retryClicked = false;
      const observer = new MutationObserver(() => {
        if (!retryClicked && mounted.container.textContent?.includes("配置已保存，但配置同步失败，请刷新后再操作。")) {
          sawCommittedSyncFailure = true;
          retryClicked = true;
          mounted.refresh();
        }
      });
      observer.observe(mounted.container, { childList: true, subtree: true, characterData: true });

      act(() => mountedButton(openProxy(mounted.container), "保存设置").click());
      await waitForMountedPanel(() => harness.providerReadCount >= 3 && harness.routeReadCount >= 2);
      observer.disconnect();

      expect(sawCommittedSyncFailure).toBe(true);
      expect((openProxy(mounted.container).querySelector('[aria-label="统一代理 URL"]') as HTMLInputElement).value).toBe("");
      expect((openSettings(providerB).querySelector('input[type="password"]') as HTMLInputElement).value).toBe("other-provider-draft");
      expect((mountedButton(openProxy(mounted.container), "保存设置") as HTMLButtonElement).disabled).toBe(true);

      const proxyDialog = openProxy(mounted.container);
      await act(async () => mountedButton(proxyDialog, "禁用").click());
      await act(async () => mountedButton(proxyDialog, "保存设置").click());
      await waitForMountedPanel(() => harness.posts.length >= 2 && harness.providerReadCount >= 4);
      expect(harness.posts[1].proxyAction).toEqual({ action: "disable" });
      expect((openSettings(providerB).querySelector('input[type="password"]') as HTMLInputElement).value).toBe("other-provider-draft");
    } finally {
      await mounted.cleanup();
    }
  });
});

describe("mounted provider model editing", () => {
  it("omits saved empty providers and falls back from a remembered empty selection", async () => {
    const previousSelection = sessionStorage.getItem("admin-page:api-provider");
    sessionStorage.setItem("admin-page:api-provider", "provider-b");
    const harness = mountedPanelHarness({ providers: [mountedProviderRow("provider-a"), { ...mountedProviderRow("provider-b"), chatModels: [] }, { ...mountedProviderRow("runninghub"), chatModels: [] }] });
    const mounted = await mountProviderPanel(harness.fetchImpl as typeof fetch);
    try {
      expect(mounted.container.querySelector('[aria-label="平台列表"]')?.textContent).not.toContain("Mounted provider-b");
      expect(mounted.container.querySelector('[aria-label="平台列表"]')?.textContent).not.toContain("Mounted runninghub");
      expect(mountedProviderCard(mounted.container, "provider-a").hidden).toBe(false);
      await changeMountedInput(mounted.container.querySelector('[aria-label="搜索平台或模型"]') as HTMLInputElement, "provider-b");
      expect(mounted.container.querySelector('[aria-label="平台列表"]')?.textContent).not.toContain("Mounted provider-b");
      expect(mounted.container.textContent).toContain("没有匹配的平台或模型");
    } finally {
      await mounted.cleanup();
      if (previousSelection === null) sessionStorage.removeItem("admin-page:api-provider");
      else sessionStorage.setItem("admin-page:api-provider", previousSelection);
    }
  });

  it("keeps the last-model removal draft editable and hides the provider only after saving", async () => {
    const harness = mountedPanelHarness({ failFirstPostSync: false });
    const mounted = await mountProviderPanel(harness.fetchImpl as typeof fetch);
    try {
      const nav = mounted.container.querySelector('[aria-label="平台列表"]') as HTMLElement;
      await act(async () => mountedButton(nav, "Mounted provider-a").click());
      const card = mountedProviderCard(mounted.container, "provider-a");
      await act(async () => card.querySelector<HTMLButtonElement>('[aria-label="移除聊天模型 provider-a-chat"]')!.click());
      expect(nav.textContent).toContain("Mounted provider-a");
      expect(card.hidden).toBe(false);
      expect(mountedButton(card, "保存本平台").disabled).toBe(false);
      await act(async () => mountedButton(card, "保存本平台").click());
      await waitForMountedPanel(() => harness.posts.length === 1 && !nav.textContent?.includes("Mounted provider-a"));
      expect(harness.posts[0].provider.chatModels).toEqual([]);
      expect(mountedProviderCard(mounted.container, "provider-b").hidden).toBe(false);
    } finally { await mounted.cleanup(); }
  });

  it("stages usages for a newly added model and applies them only after saving the provider", async () => {
    const mountedScenarios: AdminLlmScenarioView[] = [
      {
        id: "canvas.chat",
        label: "画布对话",
        visual: false,
        configured: { providerId: "provider-a", modelId: "provider-a-chat" },
        effective: { providerId: "provider-a", modelId: "provider-a-chat", status: "ready" },
        candidates: [{ providerId: "provider-a", modelId: "provider-a-chat", status: "ready" }],
      },
      {
        id: "image.role_prompt",
        label: "创作、批量技能",
        visual: true,
        configured: { providerId: "provider-a", modelId: "provider-a-chat" },
        effective: { providerId: "provider-a", modelId: "provider-a-chat", status: "ready" },
        candidates: [{ providerId: "provider-a", modelId: "provider-a-chat", status: "ready" }],
      },
    ];
    const harness = mountedPanelHarness({
      failFirstPostSync: false,
      scenarios: mountedScenarios,
      fetchModels: async () => new Response(JSON.stringify({
        ok: true,
        total: 1,
        grouped: { image: [], video: [], chat: ["new-chat-model"] },
      }), { status: 200, headers: { "Content-Type": "application/json" } }),
    });
    const mounted = await mountProviderPanel(harness.fetchImpl as typeof fetch);
    try {
      const providerA = mountedProviderCard(mounted.container, "provider-a");
      await act(async () => mountedButton(providerA, "拉取模型").click());
      await waitForMountedPanel(() => mounted.container.querySelector('[role="dialog"]') !== null);

      const dialog = mounted.container.querySelector('[role="dialog"]') as HTMLElement;
      await act(async () => mountedButton(dialog, "new-chat-model").click());
      await act(async () => mountedButton(dialog, "应用到模型列表").click());
      await waitForMountedPanel(() => providerA.textContent?.includes("new-chat-model") === true);

      const modelRow = providerA.querySelector('button[aria-label="移除聊天模型 new-chat-model"]')?.closest("tr") as HTMLElement;
      const newModelRow = modelRow;
      expect(newModelRow).toBeTruthy();
      expect(newModelRow?.querySelector('button[title="画布对话"]')).toBeNull();
      const roleUsage = newModelRow?.querySelector('button[title="创作、批量技能"]') as HTMLButtonElement | null;
      expect(roleUsage?.disabled).toBe(false);

      await act(async () => roleUsage?.click());
      expect(harness.activationCount).toBe(0);

      act(() => mountedButton(providerA, "保存本平台").click());
      await waitForMountedPanel(() => harness.posts.length === 1 && harness.activationCount === 1);

      expect(harness.posts[0].provider.chatModels).toContain("new-chat-model");
      expect(harness.actionOrder).toEqual([
        "provider-save",
        "activation:image.role_prompt",
      ]);
    } finally {
      await mounted.cleanup();
    }
  });

  it("keeps the remaining fetched chat model addable after modal confirmation without a second pull", async () => {
    const harness = mountedPanelHarness({
      failFirstPostSync: false,
      fetchModels: async () => new Response(JSON.stringify({
        ok: true,
        total: 3,
        grouped: { image: [], video: [], chat: ["chat-one", "chat-two", "chat-three"] },
      }), { status: 200, headers: { "Content-Type": "application/json" } }),
    });
    const mounted = await mountProviderPanel(harness.fetchImpl as typeof fetch);
    try {
      const providerA = mountedProviderCard(mounted.container, "provider-a");
      await act(async () => mountedButton(providerA, "拉取模型").click());
      await waitForMountedPanel(() => mounted.container.querySelector('[role="dialog"]') !== null);

      const dialog = mounted.container.querySelector('[role="dialog"]') as HTMLElement;
      await act(async () => mountedButton(dialog, "chat-one").click());
      await act(async () => mountedButton(dialog, "应用到模型列表").click());
      await waitForMountedPanel(() => mounted.container.querySelector('[role="dialog"]') === null
        && providerA.textContent?.includes("chat-one") === true);
      act(() => mountedButton(providerA, "保存本平台").click());
      await waitForMountedPanel(() => harness.posts.length === 1
        && providerA.textContent?.includes("已保存，本平台配置已立即生效") === true);

      const picker = providerA.querySelector('[aria-label="选择拉取到的 LLM 模型"]') as HTMLButtonElement;
      expect(picker.disabled).toBe(false);
      await act(async () => picker.click());
      await waitForMountedPanel(() => Array.from(document.querySelectorAll('[role="option"]'))
        .some((option) => option.textContent?.includes("chat-two")));
      const remainingOption = Array.from(document.querySelectorAll('[role="option"]'))
        .find((option) => option.textContent?.includes("chat-two")) as HTMLButtonElement;
      await act(async () => remainingOption.click());
      await act(async () => mountedButton(providerA, "添加").click());
      await waitForMountedPanel(() => providerA.textContent?.includes("chat-two") === true);

      const addButton = mountedButton(providerA, "添加") as HTMLButtonElement;
      expect(picker.title).toBe("chat-three");
      expect(addButton.disabled).toBe(false);
      await act(async () => addButton.click());
      await waitForMountedPanel(() => providerA.textContent?.includes("chat-three") === true);

      expect(providerA.textContent).toContain("chat-one");
      expect(providerA.textContent).toContain("chat-two");
      expect(providerA.textContent).toContain("chat-three");
      expect(providerA.querySelector('[aria-label="选择拉取到的 LLM 模型"]')).toBeNull();
      expect(providerA.contains(addButton)).toBe(false);
      expect(harness.modelFetchCount).toBe(1);
      expect(harness.modelFetchBodies).toHaveLength(1);
    } finally {
      await mounted.cleanup();
    }
  });
});

describe("mounted provider line-test ownership", () => {
  it.each(["success", "failure", "throw"] as const)(
    "ignores a stale %s settlement after the provider connection changes",
    async (settlement) => {
      const first = deferred<Response>();
      const harness = mountedPanelHarness({ test: () => first.promise });
      const mounted = await mountProviderPanel(harness.fetchImpl as typeof fetch);
      try {
        const providerA = mountedProviderCard(mounted.container, "provider-a");
        act(() => mountedButton(providerA, "测试连接").click());
        await waitForMountedPanel(() => harness.lineTestCount === 1);

        const baseUrl = openSettings(providerA).querySelector('input:not([type="password"])') as HTMLInputElement;
        await changeMountedInput(baseUrl, "https://provider-a.changed.example/v1");

        await act(async () => {
          if (settlement === "throw") {
            first.reject(new Error("stale-settlement-thrown"));
          } else {
            first.resolve(new Response(JSON.stringify({
              ok: settlement === "success",
              message: `stale-settlement-${settlement}`,
            }), { status: 200, headers: { "Content-Type": "application/json" } }));
          }
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
        });

        expect(providerA.textContent).not.toContain("stale-settlement");
        expect((mountedButton(providerA, "测试连接") as HTMLButtonElement).disabled).toBe(false);
      } finally {
        await mounted.cleanup();
      }
    },
  );

  it("does not let an older request clobber a newer line-test result", async () => {
    const first = deferred<Response>();
    let requestNumber = 0;
    const harness = mountedPanelHarness({
      test: () => {
        requestNumber += 1;
        if (requestNumber === 1) return first.promise;
        return new Response(JSON.stringify({ ok: true, message: "new-current-result" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    });
    const mounted = await mountProviderPanel(harness.fetchImpl as typeof fetch);
    try {
      const providerA = mountedProviderCard(mounted.container, "provider-a");
      act(() => mountedButton(providerA, "测试连接").click());
      await waitForMountedPanel(() => harness.lineTestCount === 1);

      const baseUrl = openSettings(providerA).querySelector('input:not([type="password"])') as HTMLInputElement;
      await changeMountedInput(baseUrl, "https://provider-a.newer.example/v1");
      expect((mountedButton(providerA, "测试连接") as HTMLButtonElement).disabled).toBe(false);
      act(() => mountedButton(providerA, "测试连接").click());
      await waitForMountedPanel(() => harness.lineTestCount === 2
        && providerA.textContent?.includes("new-current-result") === true);

      await act(async () => {
        first.resolve(new Response(JSON.stringify({ ok: true, message: "old-stale-result" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }));
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      });

      expect(providerA.textContent).toContain("new-current-result");
      expect(providerA.textContent).not.toContain("old-stale-result");
    } finally {
      await mounted.cleanup();
    }
  });
});

describe("provider draft mutation UI", () => {
  it("keeps proxy fields out of the page until the drawer opens", () => {
    const html = renderToStaticMarkup(React.createElement(ProvidersPanel));
    expect(html).not.toContain('aria-label="统一代理 URL"');
    expect(html).toContain("统一代理");
  });

  it("disables chat draft selection, add, and remove controls while mutations are locked", () => {
    const html = renderToStaticMarkup(React.createElement(ProviderModelUsageGroups, {
      providerId: "provider-b",
      imageModels: [],
      chatModels: ["shared-model"],
      videoModels: [],
      chatModelDraft: "candidate-model",
      chatModelOptions: ["candidate-model"],
      canManageChat: true,
      savedChatModels: ["shared-model"],
      scenarios,
      routeActions: {},
      routesDisabled: true,
      mutationsDisabled: true,
      onChatModelDraftChange: vi.fn(),
      onAddChatModel: vi.fn(),
      onActivateRoute: vi.fn(),
      onRemove: vi.fn(),
    }));
    const container = document.createElement("div");
    container.innerHTML = html;
    const select = container.querySelector('[aria-label="选择拉取到的 LLM 模型"]') as HTMLButtonElement;
    const add = mountedButton(container, "添加");
    const remove = container.querySelector('[aria-label="移除聊天模型 shared-model"]') as HTMLButtonElement;
    expect(select.disabled).toBe(true);
    expect(add.disabled).toBe(true);
    expect(remove.disabled).toBe(true);
  });

  it("disables bulk model toggles and confirmation when the runtime mutation guard denies", () => {
    const html = renderToStaticMarkup(React.createElement(ProviderModelsModal, {
      providerId: "provider-b",
      providerName: "Provider B",
      fetchedModels: { image: [], video: [], chat: ["shared-model"] },
      selectedModels: { image: [], video: [], chat: ["shared-model"] },
      supportsLlm: true,
      mutationsDisabled: false,
      canMutateDraft: () => false,
      onClose: vi.fn(),
      onConfirm: vi.fn(),
    }));
    const buttons = html.match(/<button[^>]*>/g) || [];
    const modelToggle = buttons.find((tag) => (
      html.slice(html.indexOf(tag), html.indexOf(tag) + 1000).includes("shared-model")
    ));
    const confirm = html.match(/<button([^>]*)>应用到模型列表<\/button>/)?.[1];

    expect(modelToggle).toContain('disabled=""');
    expect(confirm).toContain('disabled=""');
  });
});

describe("provider admin snapshot commit merge", () => {
  it("commits the saved provider while preserving another dirty provider and its drafts", () => {
    const savedA = snapshotProvider("provider-a");
    const savedB = snapshotProvider("provider-b");
    const dirtyA = snapshotProvider("provider-a", {
      baseUrl: "https://provider-a.draft.example/v1",
      chatModels: ["provider-a-chat-draft"],
    });
    const dirtyB = snapshotProvider("provider-b", {
      baseUrl: "https://provider-b.draft.example/v1",
      egressMode: "proxy",
      enabled: false,
      imageModels: ["provider-b-image-draft"],
      videoModels: ["provider-b-video-draft"],
      chatModels: ["provider-b-chat-draft"],
    });
    const serverA = { ...dirtyA, hasKey: true, keyPreview: "new-***", keySource: "saved" as const };

    const merged = mergeProviderAdminSnapshotCommit({
      operation: { kind: "provider-save", providerId: "provider-a" },
      currentProviders: [dirtyA, dirtyB],
      snapshotProviders: [serverA, savedB],
      savedProviderFingerprints: {
        "provider-a": snapshotFingerprint(savedA),
        "provider-b": snapshotFingerprint(savedB),
      },
      keyDrafts: { "provider-a": "new-key-a", "provider-b": "new-key-b" },
      clearKeyDrafts: { "provider-a": true, "provider-b": true },
      proxyUrlDraft: "http://proxy-draft.example:7890",
    });

    expect(merged.providers).toEqual([serverA, dirtyB]);
    expect(merged.keyDrafts).toEqual({ "provider-b": "new-key-b" });
    expect(merged.clearKeyDrafts).toEqual({ "provider-b": true });
    expect(merged.proxyUrlDraft).toBe("http://proxy-draft.example:7890");
    expect(merged.savedProviderFingerprints).toEqual({
      "provider-a": snapshotFingerprint(serverA),
      "provider-b": snapshotFingerprint(savedB),
    });
    expect(snapshotFingerprint(merged.providers[1])).not.toBe(merged.savedProviderFingerprints["provider-b"]);
    expect(merged.savedChatModelsByProviderId).toEqual({
      "provider-a": ["provider-a-chat-draft"],
      "provider-b": ["provider-b-chat-saved"],
    });
  });

  it("commits a proxy save without discarding dirty provider or key drafts", () => {
    const saved = snapshotProvider("provider-a");
    const dirty = snapshotProvider("provider-a", {
      baseUrl: "https://provider-a.draft.example/v1",
      chatModels: ["provider-a-chat-draft"],
    });

    const merged = mergeProviderAdminSnapshotCommit({
      operation: { kind: "proxy-save" },
      currentProviders: [dirty],
      snapshotProviders: [saved],
      savedProviderFingerprints: { "provider-a": snapshotFingerprint(saved) },
      keyDrafts: { "provider-a": "new-key-a" },
      clearKeyDrafts: { "provider-a": true },
      proxyUrlDraft: "http://proxy-draft.example:7890",
    });

    expect(merged.providers).toEqual([dirty]);
    expect(merged.keyDrafts).toEqual({ "provider-a": "new-key-a" });
    expect(merged.clearKeyDrafts).toEqual({ "provider-a": true });
    expect(merged.proxyUrlDraft).toBe("");
    expect(merged.savedProviderFingerprints["provider-a"]).toBe(snapshotFingerprint(saved));
    expect(snapshotFingerprint(merged.providers[0])).not.toBe(merged.savedProviderFingerprints["provider-a"]);
  });

  it.each(["refresh", "activation"] as const)("preserves dirty drafts during %s snapshot commits", (kind) => {
    const savedA = snapshotProvider("provider-a");
    const dirtyA = snapshotProvider("provider-a", { baseUrl: "https://provider-a.draft.example/v1" });
    const savedB = snapshotProvider("provider-b");
    const refreshedB = snapshotProvider("provider-b", { baseUrl: "https://provider-b.refreshed.example/v1" });

    const merged = mergeProviderAdminSnapshotCommit({
      operation: { kind },
      currentProviders: [dirtyA, savedB],
      snapshotProviders: [savedA, refreshedB],
      savedProviderFingerprints: {
        "provider-a": snapshotFingerprint(savedA),
        "provider-b": snapshotFingerprint(savedB),
      },
      keyDrafts: { "provider-a": "new-key-a" },
      clearKeyDrafts: { "provider-a": true },
      proxyUrlDraft: "http://proxy-draft.example:7890",
    });

    expect(merged.providers).toEqual([dirtyA, refreshedB]);
    expect(merged.keyDrafts).toEqual({ "provider-a": "new-key-a" });
    expect(merged.clearKeyDrafts).toEqual({ "provider-a": true });
    expect(merged.proxyUrlDraft).toBe("http://proxy-draft.example:7890");
    expect(merged.savedProviderFingerprints).toEqual({
      "provider-a": snapshotFingerprint(savedA),
      "provider-b": snapshotFingerprint(refreshedB),
    });
  });

  it("does not revive a dirty local provider missing from the server snapshot", () => {
    const orphan = snapshotProvider("provider-orphan", { baseUrl: "https://orphan.draft.example/v1" });
    const server = snapshotProvider("provider-server");

    const merged = mergeProviderAdminSnapshotCommit({
      operation: { kind: "refresh" },
      currentProviders: [orphan],
      snapshotProviders: [server],
      savedProviderFingerprints: { "provider-orphan": snapshotFingerprint(snapshotProvider("provider-orphan")) },
      keyDrafts: { "provider-orphan": "orphan-key" },
      clearKeyDrafts: { "provider-orphan": true },
      proxyUrlDraft: "",
    });

    expect(merged.providers).toEqual([server]);
    expect(merged.savedProviderFingerprints).toEqual({ "provider-server": snapshotFingerprint(server) });
    expect(merged.savedChatModelsByProviderId).toEqual({ "provider-server": ["provider-server-chat-saved"] });
    expect(merged.keyDrafts).toEqual({});
    expect(merged.clearKeyDrafts).toEqual({});
  });

  it("does not treat an unknown non-custom row without a fingerprint as a custom draft", () => {
    const unknown = snapshotProvider("temporary-row", {
      baseUrl: "https://temporary-row.local.example/v1",
      keySource: "none",
    });
    const server = snapshotProvider("provider-server");

    const merged = mergeProviderAdminSnapshotCommit({
      operation: { kind: "refresh" },
      currentProviders: [unknown],
      snapshotProviders: [server],
      savedProviderFingerprints: {},
      keyDrafts: { "temporary-row": "temporary-key" },
      clearKeyDrafts: {},
      proxyUrlDraft: "",
    });

    expect(merged.providers).toEqual([server]);
    expect(merged.keyDrafts).toEqual({});
  });

  it("uses the full server snapshot for an initial load without drafts", () => {
    const server = snapshotProvider("provider-server");

    const merged = mergeProviderAdminSnapshotCommit({
      operation: { kind: "refresh" },
      currentProviders: [],
      snapshotProviders: [server],
      savedProviderFingerprints: {},
      keyDrafts: {},
      clearKeyDrafts: {},
      proxyUrlDraft: "",
    });

    expect(merged).toEqual({
      providers: [server],
      savedProviderFingerprints: { "provider-server": snapshotFingerprint(server) },
      savedChatModelsByProviderId: { "provider-server": ["provider-server-chat-saved"] },
      keyDrafts: {},
      clearKeyDrafts: {},
      proxyUrlDraft: "",
    });
  });

  it.each([
    { kind: "refresh" as const },
    { kind: "activation" as const },
    { kind: "provider-save" as const, providerId: "provider-a" },
    { kind: "proxy-save" as const },
  ])("preserves a never-saved custom provider during $kind snapshot commits", (operation) => {
    const savedA = snapshotProvider("provider-a");
    const refreshedA = snapshotProvider("provider-a", { baseUrl: "https://provider-a.refreshed.example/v1" });
    const customDraft = snapshotProvider("custom-local", {
      name: "Local custom",
      baseUrl: "https://custom-local.draft.example/v1",
      chatModels: ["custom-chat-draft"],
      hasKey: false,
      keyPreview: "",
      keySource: "none",
    });

    const merged = mergeProviderAdminSnapshotCommit({
      operation,
      currentProviders: [savedA, customDraft],
      snapshotProviders: [refreshedA],
      savedProviderFingerprints: { "provider-a": snapshotFingerprint(savedA) },
      keyDrafts: { "custom-local": "custom-key-draft" },
      clearKeyDrafts: {},
      proxyUrlDraft: "http://proxy-draft.example:7890",
    });

    expect(merged.providers).toEqual([refreshedA, customDraft]);
    expect(merged.savedProviderFingerprints).toEqual({
      "provider-a": snapshotFingerprint(refreshedA),
    });
    expect(merged.savedChatModelsByProviderId).toEqual({
      "provider-a": ["provider-a-chat-saved"],
    });
    expect(merged.keyDrafts).toEqual({ "custom-local": "custom-key-draft" });
    expect(merged.proxyUrlDraft).toBe(operation.kind === "proxy-save"
      ? ""
      : "http://proxy-draft.example:7890");
  });
});

describe("provider admin production payload orchestration", () => {
  it("saves dirty A and then sends preserved dirty B with its key and latest revision", async () => {
    const savedA = snapshotProvider("provider-a");
    const savedB = snapshotProvider("provider-b");
    const dirtyA = snapshotProvider("provider-a", {
      baseUrl: "https://provider-a.draft.example/v1",
      chatModels: ["provider-a-chat-draft"],
    });
    const dirtyB = snapshotProvider("provider-b", {
      baseUrl: "https://provider-b.draft.example/v1",
      imageModels: ["provider-b-image-draft"],
      videoModels: ["provider-b-video-draft"],
      chatModels: ["provider-b-chat-draft"],
    });
    const serverA = { ...dirtyA, keyPreview: "a-new-***" };
    const serverB = { ...dirtyB, keyPreview: "b-new-***" };
    const state: PayloadDraftState = {
      providers: [dirtyA, dirtyB],
      savedProviderFingerprints: {
        "provider-a": snapshotFingerprint(savedA),
        "provider-b": snapshotFingerprint(savedB),
      },
      keyDrafts: { "provider-a": "key-a-draft", "provider-b": "key-b-draft" },
      clearKeyDrafts: {},
      proxyUrlDraft: "http://proxy-draft.example:7890",
    };
    const bodies: any[] = [];
    let nextSnapshotProviders = [serverA, savedB];
    let nextRevision = "revision-2";
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body || "{}")));
      return new Response(JSON.stringify({
        success: true,
        providers: nextSnapshotProviders,
        proxy: { overrideState: "inherit", source: "none", preview: null, hasCredentials: false },
        proxyStatusByProviderId: {},
        revision: `write-${bodies.length}`,
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    const controller = createTestController({
      initialRevision: "revision-1",
      fetchImpl,
      prepareSnapshots: async (operation) => {
        const preparedProviders = nextSnapshotProviders;
        const preparedRevision = nextRevision;
        return {
          revision: preparedRevision,
          commit: () => commitPayloadDraftSnapshot(state, operation, preparedProviders),
        };
      },
    });

    await controller.save((expectedRevision) => requestProviderAdminProviderSave(fetchImpl, {
      expectedRevision,
      provider: state.providers.find((provider) => provider.id === "provider-a")!,
      apiKey: state.keyDrafts["provider-a"],
      clearApiKey: state.clearKeyDrafts["provider-a"] === true,
    }), { kind: "provider-save", providerId: "provider-a" });

    expect(state.providers).toEqual([serverA, dirtyB]);
    expect(state.keyDrafts).toEqual({ "provider-b": "key-b-draft" });
    nextSnapshotProviders = [serverA, serverB];
    nextRevision = "revision-3";
    await controller.save((expectedRevision) => requestProviderAdminProviderSave(fetchImpl, {
      expectedRevision,
      provider: state.providers.find((provider) => provider.id === "provider-b")!,
      apiKey: state.keyDrafts["provider-b"],
      clearApiKey: state.clearKeyDrafts["provider-b"] === true,
    }), { kind: "provider-save", providerId: "provider-b" });

    expect(bodies[1]).toEqual({
      expectedRevision: "revision-2",
      provider: {
        ...dirtyB,
        apiKey: "key-b-draft",
        clearApiKey: false,
      },
      proxyAction: { action: "keep" },
    });
  });

  it("keeps a dirty provider payload intact after saving the proxy", async () => {
    const saved = snapshotProvider("provider-a");
    const dirty = snapshotProvider("provider-a", {
      baseUrl: "https://provider-a.dirty.example/v1",
      chatModels: ["provider-a-chat-dirty"],
    });
    const serverDirty = { ...dirty, keyPreview: "new-***" };
    const state: PayloadDraftState = {
      providers: [dirty],
      savedProviderFingerprints: { "provider-a": snapshotFingerprint(saved) },
      keyDrafts: { "provider-a": "provider-key-draft" },
      clearKeyDrafts: {},
      proxyUrlDraft: "http://proxy-draft.example:7890",
    };
    const bodies: any[] = [];
    let nextSnapshotProviders = [saved];
    let nextRevision = "revision-2";
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body || "{}")));
      return new Response(JSON.stringify({
        success: true,
        providers: nextSnapshotProviders,
        proxy: { overrideState: "configured", source: "saved", preview: "http://proxy-***", hasCredentials: false },
        proxyStatusByProviderId: {},
        revision: `write-${bodies.length}`,
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    const controller = createTestController({
      initialRevision: "revision-1",
      fetchImpl,
      prepareSnapshots: async (operation) => {
        const preparedProviders = nextSnapshotProviders;
        const preparedRevision = nextRevision;
        return {
          revision: preparedRevision,
          commit: () => commitPayloadDraftSnapshot(state, operation, preparedProviders),
        };
      },
    });

    await controller.save((expectedRevision) => requestProviderAdminProxySave(fetchImpl, {
      expectedRevision,
      proxyAction: { action: "set", url: state.proxyUrlDraft },
    }), { kind: "proxy-save" });

    expect(state.providers).toEqual([dirty]);
    expect(state.keyDrafts).toEqual({ "provider-a": "provider-key-draft" });
    nextSnapshotProviders = [serverDirty];
    nextRevision = "revision-3";
    await controller.save((expectedRevision) => requestProviderAdminProviderSave(fetchImpl, {
      expectedRevision,
      provider: state.providers[0],
      apiKey: state.keyDrafts["provider-a"],
      clearApiKey: state.clearKeyDrafts["provider-a"] === true,
    }), { kind: "provider-save", providerId: "provider-a" });

    expect(bodies[1]).toEqual({
      expectedRevision: "revision-2",
      provider: {
        ...dirty,
        apiKey: "provider-key-draft",
        clearApiKey: false,
      },
      proxyAction: { action: "keep" },
    });
  });

  it("sends a preserved proxy draft after a provider save with the latest revision", async () => {
    const saved = snapshotProvider("provider-a");
    const dirty = snapshotProvider("provider-a", { baseUrl: "https://provider-a.dirty.example/v1" });
    const state: PayloadDraftState = {
      providers: [dirty],
      savedProviderFingerprints: { "provider-a": snapshotFingerprint(saved) },
      keyDrafts: {},
      clearKeyDrafts: {},
      proxyUrlDraft: "http://proxy-after-provider.example:7890",
    };
    const bodies: any[] = [];
    let nextRevision = "revision-2";
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body || "{}")));
      return new Response(JSON.stringify({
        success: true,
        providers: [dirty],
        proxy: { overrideState: "inherit", source: "none", preview: null, hasCredentials: false },
        proxyStatusByProviderId: {},
        revision: `write-${bodies.length}`,
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    const controller = createTestController({
      initialRevision: "revision-1",
      fetchImpl,
      prepareSnapshots: async (operation) => {
        const preparedRevision = nextRevision;
        return {
          revision: preparedRevision,
          commit: () => commitPayloadDraftSnapshot(state, operation, [dirty]),
        };
      },
    });

    await controller.save((expectedRevision) => requestProviderAdminProviderSave(fetchImpl, {
      expectedRevision,
      provider: state.providers[0],
      clearApiKey: false,
    }), { kind: "provider-save", providerId: "provider-a" });

    expect(state.proxyUrlDraft).toBe("http://proxy-after-provider.example:7890");
    nextRevision = "revision-3";
    await controller.save((expectedRevision) => requestProviderAdminProxySave(fetchImpl, {
      expectedRevision,
      proxyAction: { action: "set", url: state.proxyUrlDraft },
    }), { kind: "proxy-save" });

    expect(bodies[1]).toEqual({
      expectedRevision: "revision-2",
      proxyAction: { action: "set", url: "http://proxy-after-provider.example:7890" },
    });
  });
});

describe("provider LLM activation orchestration", () => {
  it("blocks same-tick field and custom draft mutations while a save owner is active", async () => {
    const saveResponse = deferred<{ revision: string }>();
    const controller = createTestController({
      initialRevision: "revision-1",
      fetchImpl: vi.fn(),
      prepareSnapshots: vi.fn(async () => ({ revision: "revision-2", commit: vi.fn() })),
    });
    const targetDraft = { baseUrl: "https://before.example/v1" };
    const customDrafts: string[] = [];
    const ownedSave = controller.save(() => saveResponse.promise, {
      kind: "provider-save",
      providerId: "provider-a",
    });

    expect(controller.getState().operation).toEqual({ kind: "writing" });
    expect(canMutateAdminDraft(controller.getState())).toBe(false);
    expect(guardAdminDraftMutation(controller.getState(), () => {
      targetDraft.baseUrl = "https://during-save.example/v1";
    })).toBe(false);
    expect(guardAdminDraftMutation(controller.getState(), () => {
      customDrafts.push("custom-during-save");
    })).toBe(false);
    expect(targetDraft.baseUrl).toBe("https://before.example/v1");
    expect(customDrafts).toEqual([]);

    saveResponse.resolve({ revision: "revision-2" });
    await expect(ownedSave).resolves.toMatchObject({ kind: "success" });
    expect(canMutateAdminDraft(controller.getState())).toBe(true);
  });

  it("only allows draft mutations while sync and operation state are ready and idle", () => {
    const controller = createTestController({ initialRevision: "revision-1", fetchImpl: vi.fn() });
    const ready = controller.getState();

    expect(canMutateAdminDraft(ready)).toBe(true);
    expect(canMutateAdminDraft({ ...ready, operation: { kind: "refreshing" } })).toBe(false);
    expect(canMutateAdminDraft({ ...ready, operation: { kind: "writing" } })).toBe(false);
    expect(canMutateAdminDraft({ ...ready, operation: { kind: "activating" } })).toBe(false);
    expect(canMutateAdminDraft({ ...ready, sync: { kind: "refreshing" } })).toBe(false);
    expect(canMutateAdminDraft({ ...ready, sync: { kind: "sync_failed" } })).toBe(false);
    expect(canMutateAdminDraft({
      ...ready,
      actions: {
        "canvas.chat": {
          kind: "busy",
          providerId: "provider-a",
          modelId: "model-a",
        },
      },
    })).toBe(false);
  });

  it.each(["provider", "proxy"] as const)("owns a pending %s save through its post-save snapshot sync", async (saveKind) => {
    const saveResponse = deferred<{ revision: string }>();
    const commit = vi.fn();
    const prepareSnapshots = vi.fn(async () => ({ revision: "revision-2", commit }));
    const activationFetch = vi.fn(async () => new Response(JSON.stringify({ success: true }), { status: 200 }));
    const controller = createProviderLlmAdminController({
      initialRevision: "revision-1",
      fetchImpl: activationFetch,
      prepareSnapshots,
    });
    const providerSave = vi.fn(() => saveResponse.promise);
    const operation = saveKind === "provider"
      ? { kind: "provider-save" as const, providerId: "provider-a" }
      : { kind: "proxy-save" as const };
    const ownedSave = controller.save(providerSave, operation);
    expect(providerSave).toHaveBeenCalledWith("revision-1");
    expect(controller.getState()).toMatchObject({ operation: { kind: "writing" } });

    await expect(controller.refresh()).resolves.toBe("busy");
    const proxySave = vi.fn(async () => ({ revision: "proxy-must-not-run" }));
    await expect(controller.save(proxySave)).resolves.toMatchObject({ kind: "blocked" });
    await expect(controller.activate({
      scenarioId: "canvas.chat",
      binding: { providerId: "provider-b", modelId: "shared-model" },
      scenarios: [{ ...scenarios[0], configured: null, effective: { status: "missing-binding" } }],
      hasUnsavedProviderChanges: false,
    })).resolves.toBe("busy");
    expect(prepareSnapshots).not.toHaveBeenCalled();
    expect(proxySave).not.toHaveBeenCalled();
    expect(activationFetch).not.toHaveBeenCalled();

    saveResponse.resolve({ revision: "revision-2" });
    await expect(ownedSave).resolves.toMatchObject({ kind: "success" });
    expect(prepareSnapshots).toHaveBeenCalledTimes(1);
    expect(prepareSnapshots).toHaveBeenCalledWith(operation);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(controller.getState()).toMatchObject({
      revision: "revision-2",
      sync: { kind: "ready" },
      operation: { kind: "idle" },
    });

    const nextSave = vi.fn(async (expectedRevision: string) => ({ revision: expectedRevision }));
    await expect(controller.save(nextSave, operation)).resolves.toMatchObject({ kind: "success" });
    expect(nextSave).toHaveBeenCalledWith("revision-2");
  });

  it("releases save ownership without refreshing when the save request fails", async () => {
    const commit = vi.fn();
    const prepareSnapshots = vi.fn(async () => ({ revision: "revision-2", commit }));
    const controller = createProviderLlmAdminController({
      initialRevision: "revision-1",
      fetchImpl: vi.fn(),
      prepareSnapshots,
    });
    const failedSave = vi.fn(async () => {
      throw new Error("save request failed");
    });

    await expect(controller.save(failedSave)).rejects.toThrow("save request failed");
    expect(prepareSnapshots).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
    expect(controller.getState()).toMatchObject({
      revision: "revision-1",
      sync: { kind: "ready" },
      operation: { kind: "idle" },
    });

    const nextSave = vi.fn(async () => ({ revision: "revision-2" }));
    await expect(controller.save(nextSave)).resolves.toMatchObject({ kind: "success" });
    expect(nextSave).toHaveBeenCalledWith("revision-1");
    expect(prepareSnapshots).toHaveBeenCalledTimes(1);
  });

  it("keeps a committed save distinct from a failed post-save snapshot sync", async () => {
    let snapshotFails = true;
    const saveRequest = vi.fn(async () => ({ revision: "revision-2" }));
    const controller = createProviderLlmAdminController({
      initialRevision: "revision-1",
      fetchImpl: vi.fn(),
      prepareSnapshots: async () => {
        if (snapshotFails) throw new Error("snapshot unavailable");
        return { revision: "revision-2", commit: vi.fn() };
      },
    });

    await expect(controller.save(saveRequest)).resolves.toEqual({
      kind: "sync_failed",
      data: { revision: "revision-2" },
      message: "配置已保存，但配置同步失败，请刷新后再操作。",
    });
    expect(controller.getState()).toMatchObject({
      revision: "revision-2",
      sync: { kind: "sync_failed", message: "配置已保存，但配置同步失败，请刷新后再操作。" },
      operation: { kind: "idle" },
    });

    const blockedSave = vi.fn(async () => ({ revision: "must-not-run" }));
    await expect(controller.save(blockedSave)).resolves.toEqual({
      kind: "blocked",
      message: "配置已保存，但配置同步失败，请刷新后再操作。",
    });
    expect(blockedSave).not.toHaveBeenCalled();

    snapshotFails = false;
    await expect(controller.refresh()).resolves.toBe("success");
    expect(saveRequest).toHaveBeenCalledTimes(1);
    expect(controller.getState()).toMatchObject({
      revision: "revision-2",
      sync: { kind: "ready" },
      operation: { kind: "idle" },
    });
  });

  it("single-flights refreshes, locks revision writes, and unlocks with the refreshed revision", async () => {
    const providerSnapshot = deferred<string>();
    const reloadProviders = vi.fn(() => providerSnapshot.promise);
    const reloadRoutes = vi.fn(async () => undefined);
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ success: true }), { status: 200 }));
    const controller = createTestController({
      initialRevision: "old-revision",
      fetchImpl,
      reloadProviders,
      reloadRoutes,
    });

    const refreshA = controller.refresh();
    const refreshB = controller.refresh();
    expect(controller.getState().sync).toMatchObject({ kind: "refreshing" });
    expect(reloadProviders).toHaveBeenCalledTimes(1);

    await expect(controller.activate({
      scenarioId: "canvas.chat",
      binding: { providerId: "provider-b", modelId: "shared-model" },
      scenarios: [{ ...scenarios[0], configured: null, effective: { status: "missing-binding" } }],
      hasUnsavedProviderChanges: false,
    })).resolves.toBe("busy");
    const providerSave = vi.fn(async () => ({ revision: "provider-save-must-not-run" }));
    const proxySave = vi.fn(async () => ({ revision: "proxy-save-must-not-run" }));
    await expect(controller.save(providerSave)).resolves.toMatchObject({ kind: "blocked" });
    await expect(controller.save(proxySave)).resolves.toMatchObject({ kind: "blocked" });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(providerSave).not.toHaveBeenCalled();
    expect(proxySave).not.toHaveBeenCalled();

    providerSnapshot.resolve("new-revision");
    await expect(refreshA).resolves.toBe("success");
    await expect(refreshB).resolves.toBe("success");
    expect(reloadProviders).toHaveBeenCalledTimes(1);
    expect(reloadRoutes).toHaveBeenCalledTimes(1);
    expect(controller.getState()).toMatchObject({
      revision: "new-revision",
      sync: { kind: "ready" },
    });

    const saveAfterRefresh = vi.fn(async (expectedRevision: string) => ({ revision: `${expectedRevision}-saved` }));
    await expect(controller.save(saveAfterRefresh)).resolves.toMatchObject({ kind: "success" });
    expect(saveAfterRefresh).toHaveBeenCalledWith("new-revision");
  });

  it("commits a prepared provider and route snapshot only after the whole refresh round succeeds", async () => {
    const preparedRound = deferred<{ revision: string; commit: () => void }>();
    const commit = vi.fn();
    const prepareSnapshots = vi.fn(() => preparedRound.promise);
    const legacyProviderReload = vi.fn(async () => "legacy-revision");
    const legacyRouteReload = vi.fn(async () => undefined);
    const controller = createProviderLlmAdminController({
      initialRevision: "old-revision",
      fetchImpl: vi.fn(),
      prepareSnapshots,
      reloadProviders: legacyProviderReload,
      reloadRoutes: legacyRouteReload,
    });

    const refresh = controller.refresh();
    expect(commit).not.toHaveBeenCalled();
    preparedRound.resolve({ revision: "atomic-revision", commit });

    await expect(refresh).resolves.toBe("success");
    expect(prepareSnapshots).toHaveBeenCalledTimes(1);
    expect(prepareSnapshots).toHaveBeenCalledWith({ kind: "refresh" });
    expect(legacyProviderReload).not.toHaveBeenCalled();
    expect(legacyRouteReload).not.toHaveBeenCalled();
    expect(commit).toHaveBeenCalledTimes(1);
    expect(controller.getState()).toMatchObject({
      revision: "atomic-revision",
      sync: { kind: "ready" },
    });
  });

  it("keeps the old revision and reports an ordinary refresh failure without a permanent lock", async () => {
    let providerReloadFails = true;
    const controller = createTestController({
      initialRevision: "old-revision",
      fetchImpl: vi.fn(),
      reloadProviders: async () => {
        if (providerReloadFails) throw new Error("provider snapshot unavailable");
        return "old-revision";
      },
      reloadRoutes: async () => undefined,
    });

    await expect(controller.refresh()).resolves.toBe("error");
    expect(controller.getState()).toMatchObject({
      revision: "old-revision",
      sync: { kind: "ready", message: "provider snapshot unavailable" },
    });

    providerReloadFails = false;
    const saveRequest = vi.fn(async (expectedRevision: string) => ({ revision: expectedRevision }));
    await expect(controller.save(saveRequest)).resolves.toMatchObject({ kind: "success" });
    expect(saveRequest).toHaveBeenCalledWith("old-revision");
  });

  it("runs post-activation snapshot sync through the same single-flight refresh orchestration", async () => {
    const activationResponse = deferred<Response>();
    const preparedRound = deferred<{ revision: string; commit: () => void }>();
    const commit = vi.fn();
    const prepareSnapshots = vi.fn(() => preparedRound.promise);
    const controller = createProviderLlmAdminController({
      initialRevision: "old-revision",
      fetchImpl: vi.fn(() => activationResponse.promise),
      prepareSnapshots,
    });

    const activation = controller.activate({
      scenarioId: "canvas.chat",
      binding: { providerId: "provider-b", modelId: "shared-model" },
      scenarios: [{ ...scenarios[0], configured: null, effective: { status: "missing-binding" } }],
      hasUnsavedProviderChanges: false,
    });
    expect(controller.getState().operation).toMatchObject({ kind: "activating" });
    await expect(controller.refresh()).resolves.toBe("busy");
    expect(prepareSnapshots).not.toHaveBeenCalled();

    activationResponse.resolve(new Response(JSON.stringify({ success: true }), { status: 200 }));
    await vi.waitFor(() => expect(prepareSnapshots).toHaveBeenCalledTimes(1));
    expect(prepareSnapshots).toHaveBeenCalledWith({ kind: "activation" });

    expect(controller.getState().sync).toMatchObject({ kind: "refreshing" });
    expect(controller.getState().operation).toMatchObject({ kind: "refreshing" });
    const joinedRefresh = controller.refresh();
    expect(prepareSnapshots).toHaveBeenCalledTimes(1);

    preparedRound.resolve({ revision: "activation-revision", commit });
    await expect(activation).resolves.toBe("success");
    await expect(joinedRefresh).resolves.toBe("busy");
    expect(commit).toHaveBeenCalledTimes(1);
    expect(controller.getState()).toMatchObject({
      revision: "activation-revision",
      sync: { kind: "ready" },
      operation: { kind: "idle" },
    });
  });

  it("treats HTTP 200 as committed before classifying a later sync failure", async () => {
    const controller = createTestController({
      initialRevision: "old-revision",
      fetchImpl: vi.fn(async () => new Response(JSON.stringify({}), { status: 200 })),
      reloadProviders: async () => { throw new Error("snapshot unavailable"); },
      reloadRoutes: async () => undefined,
    });

    await expect(controller.activate({
      scenarioId: "canvas.chat",
      binding: { providerId: "provider-b", modelId: "shared-model" },
      scenarios: [{ ...scenarios[0], configured: null, effective: { status: "missing-binding" } }],
      hasUnsavedProviderChanges: false,
    })).resolves.toBe("sync_failed");
    expect(controller.getState().actions["canvas.chat"]).toMatchObject({ kind: "sync_failed" });
  });

  it("serializes one scenario across rows and accepts a new activation after settlement", async () => {
    const firstResponse = deferred<Response>();
    const fetchImpl = vi.fn()
      .mockImplementationOnce(() => firstResponse.promise)
      .mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200 }));
    const controller = createTestController({
      initialRevision: "revision-1",
      fetchImpl,
      reloadProviders: async () => "revision-2",
      reloadRoutes: async () => undefined,
    });
    const availableScenarios = [{
      ...scenarios[0],
      configured: null,
      effective: { status: "missing-binding" },
      candidates: [
        { providerId: "provider-a", modelId: "model-a", status: "ready" },
        { providerId: "provider-b", modelId: "model-b", status: "ready" },
      ],
    }];

    const first = controller.activate({
      scenarioId: "canvas.chat",
      binding: { providerId: "provider-a", modelId: "model-a" },
      scenarios: availableScenarios,
      hasUnsavedProviderChanges: false,
    });
    expect(controller.getState().actions["canvas.chat"]).toMatchObject({
      kind: "busy",
      providerId: "provider-a",
      modelId: "model-a",
    });
    const saveWhileBusy = vi.fn(async () => ({ revision: "should-not-save" }));
    await expect(controller.save(saveWhileBusy)).resolves.toMatchObject({ kind: "blocked" });
    expect(saveWhileBusy).not.toHaveBeenCalled();

    const duplicate = await controller.activate({
      scenarioId: "canvas.chat",
      binding: { providerId: "provider-b", modelId: "model-b" },
      scenarios: availableScenarios,
      hasUnsavedProviderChanges: false,
    });
    expect(duplicate).toBe("busy");
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    const otherScenario = await controller.activate({
      scenarioId: "image.role_prompt",
      binding: { providerId: "provider-b", modelId: "model-b" },
      scenarios: availableScenarios,
      hasUnsavedProviderChanges: false,
    });
    expect(otherScenario).toBe("busy");
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    firstResponse.resolve(new Response(JSON.stringify({ success: true }), { status: 200 }));
    await expect(first).resolves.toBe("success");
    await expect(controller.activate({
      scenarioId: "canvas.chat",
      binding: { providerId: "provider-b", modelId: "model-b" },
      scenarios: availableScenarios,
      hasUnsavedProviderChanges: false,
    })).resolves.toBe("success");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("locks saves after a committed activation when provider sync fails and refresh recovers without another POST", async () => {
    let providerReloadFails = true;
    let latestRevision = "revision-after-refresh";
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ success: true }), { status: 200 }));
    const reloadProviders = vi.fn(async () => {
      if (providerReloadFails) throw new Error("provider snapshot unavailable");
      return latestRevision;
    });
    const reloadRoutes = vi.fn(async () => undefined);
    const controller = createTestController({
      initialRevision: "old-revision",
      fetchImpl,
      reloadProviders,
      reloadRoutes,
    });

    const activation = await controller.activate({
      scenarioId: "canvas.chat",
      binding: { providerId: "provider-b", modelId: "shared-model" },
      scenarios: [{ ...scenarios[0], configured: null, effective: { status: "missing-binding" } }],
      hasUnsavedProviderChanges: false,
    });

    expect(activation).toBe("sync_failed");
    expect(controller.getState().sync).toEqual({
      kind: "sync_failed",
      message: "模型已激活，但配置同步失败，请刷新后再操作。",
    });
    expect(controller.getState().actions["canvas.chat"]).toMatchObject({
      kind: "sync_failed",
      providerId: "provider-b",
      modelId: "shared-model",
      message: "模型已激活，但配置同步失败，请刷新后再操作。",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith("/api/admin/llm-routes/canvas.chat/activate", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ providerId: "provider-b", modelId: "shared-model" }),
    }));
    await expect(controller.activate({
      scenarioId: "image.role_prompt",
      binding: { providerId: "provider-b", modelId: "shared-model" },
      scenarios,
      hasUnsavedProviderChanges: false,
    })).resolves.toBe("blocked");
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    const saveRequest = vi.fn(async (expectedRevision: string) => {
      latestRevision = `${expectedRevision}-saved`;
      return { revision: latestRevision };
    });
    await expect(controller.save(saveRequest)).resolves.toEqual({
      kind: "blocked",
      message: "模型已激活，但配置同步失败，请刷新后再操作。",
    });
    expect(saveRequest).not.toHaveBeenCalled();

    providerReloadFails = false;
    await expect(controller.retrySync()).resolves.toBe("success");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(reloadProviders).toHaveBeenCalledTimes(2);
    expect(reloadRoutes).toHaveBeenCalledTimes(1);
    expect(controller.getState()).toMatchObject({
      revision: "revision-after-refresh",
      sync: { kind: "ready" },
    });

    await expect(controller.save(saveRequest)).resolves.toMatchObject({ kind: "success" });
    expect(saveRequest).toHaveBeenCalledWith("revision-after-refresh");
    expect(controller.getState().revision).toBe("revision-after-refresh-saved");
  });

  it("does not commit the provider revision when the route snapshot in the same refresh round fails", async () => {
    let routeReloadFails = true;
    let providerReloadCount = 0;
    const observedStates: Array<ReturnType<TestController["getState"]>> = [];
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ success: true }), { status: 200 }));
    const controller = createTestController({
      initialRevision: "old-revision",
      fetchImpl,
      reloadProviders: async () => {
        providerReloadCount += 1;
        return providerReloadCount === 1 ? "committed-revision" : "refreshed-revision";
      },
      reloadRoutes: async () => {
        if (routeReloadFails) throw new Error("route snapshot unavailable");
      },
      onStateChange: (state) => observedStates.push(state),
    });

    await expect(controller.activate({
      scenarioId: "image.role_prompt",
      binding: { providerId: "provider-b", modelId: "shared-model" },
      scenarios: [{ ...scenarios[1], configured: null, effective: { status: "missing-binding" } }],
      hasUnsavedProviderChanges: false,
    })).resolves.toBe("sync_failed");
    expect(controller.getState()).toMatchObject({
      revision: "old-revision",
      sync: { kind: "sync_failed" },
      actions: { "image.role_prompt": { kind: "sync_failed" } },
    });
    expect(observedStates.at(-1)).toMatchObject({
      revision: "old-revision",
      sync: { kind: "sync_failed" },
    });

    const saveRequest = vi.fn(async (expectedRevision: string) => ({ revision: expectedRevision }));
    await expect(controller.save(saveRequest)).resolves.toMatchObject({ kind: "blocked" });
    expect(saveRequest).not.toHaveBeenCalled();

    routeReloadFails = false;
    await expect(controller.retrySync()).resolves.toBe("success");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(controller.getState()).toMatchObject({
      revision: "refreshed-revision",
      sync: { kind: "ready" },
    });
    expect(observedStates.at(-1)).toMatchObject({
      revision: "refreshed-revision",
      sync: { kind: "ready" },
    });
  });

  it("keeps the old active binding and reports only the target-row error when activation fails", async () => {
    const oldScenarios = scenarios.map((scenario) => ({
      ...scenario,
      configured: { providerId: "old-provider", modelId: "old-model" },
      effective: { providerId: "old-provider", modelId: "old-model", status: "ready" },
    }));
    const reloadProviders = vi.fn();
    const reloadRoutes = vi.fn();
    const controller = createTestController({
      initialRevision: "old-revision",
      fetchImpl: vi.fn(async () => new Response(JSON.stringify({
        success: false,
        error: "probe failed",
      }), { status: 502 })),
      reloadProviders,
      reloadRoutes,
    });

    const result = await controller.activate({
      scenarioId: "canvas.chat",
      binding: { providerId: "provider-b", modelId: "shared-model" },
      scenarios: oldScenarios,
      hasUnsavedProviderChanges: false,
    });

    expect(result).toBe("error");
    expect(oldScenarios[0].configured).toEqual({ providerId: "old-provider", modelId: "old-model" });
    expect(controller.getState()).toMatchObject({
      revision: "old-revision",
      sync: { kind: "ready" },
      actions: {
        "canvas.chat": {
          providerId: "provider-b",
          modelId: "shared-model",
          kind: "error",
          message: "probe failed",
        },
      },
    });
    expect(reloadProviders).not.toHaveBeenCalled();
    expect(reloadRoutes).not.toHaveBeenCalled();
  });
});
