import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { act, Simulate } from "react-dom/test-utils";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ephemeralInputDraftRegistry } from "@/lib/ephemeral-input-draft";

const mocks = vi.hoisted(() => ({ user: { id: "readiness-user" }, panel: null as any }));
vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => ({ user: mocks.user, loading: false }) }));
vi.mock("@/hooks/use-batch-role-positioning-controller", () => ({ useBatchRolePositioningController: () => ({ reversePrompt: "", continuation: null, hydrated: true }) }));
vi.mock("@/lib/client/image-model-catalog", () => ({ loadImageModelCatalog: async () => (await fetch("/api/image-edit/models")).json() }));
vi.mock("@/components/batch-workbench/batch-settings-panel", async (original) => ({
  ...await original<typeof import("@/components/batch-workbench/batch-settings-panel")>(),
  BatchSettingsPanel: (props: any) => {
    mocks.panel = props;
    return React.createElement("textarea", {
      "aria-label": "提示词", value: props.batch.sharedPrompt, disabled: props.disabled,
      onChange: (event: any) => props.onBatchChange({ sharedPrompt: event.target.value }),
    });
  },
}));
vi.mock("@/components/batch-workbench/live-video-batch-workspace", () => ({ LiveVideoBatchWorkspace: () => null }));
vi.mock("@/components/batch-workbench/unified-batch-results", () => ({ UnifiedBatchResults: () => null }));
vi.mock("@/components/media-library/media-library-panel", () => ({ MediaLibraryPanel: () => null }));
vi.mock("@/components/ui/media-lightbox", () => ({ MediaLightbox: () => null }));
vi.mock("@/components/ui/confirm-dialog", () => ({ ConfirmDialog: (props: any) => props.open ? React.createElement("div", { role: "dialog" }, props.children) : null }));
vi.mock("@/components/batch-workbench/prompt-split-dialog", () => ({ PromptSplitDialog: () => null }));
import { BatchWorkbenchPage } from "@/components/batch-workbench/batch-workbench-page";

const batch = {
  id: "ready-draft", name: "Draft", mode: "style_replication", status: "draft", sharedPrompt: "",
  sharedSettings: { schemaVersion: 1, model: "nano-banana-pro", aspectRatio: "3:4", resolution: "2K" },
  version: 1, updatedAt: "2026-09-28T00:00:00Z", items: [], groups: [], media: [],
};
const json = (body: unknown) => new Response(JSON.stringify({ success: true, ...body as object }));
let root: Root;
let host: HTMLDivElement;
let finishHistory: Array<() => void>;
let failHistory: Array<() => void>;
let finishModels: (() => void) | undefined;
let request: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  ephemeralInputDraftRegistry.clearOwner(mocks.user.id);
  mocks.panel = null;
  finishHistory = [];
  failHistory = [];
  finishModels = undefined;
  request = vi.fn((url: string, init?: RequestInit) => {
    if (url.includes("/api/image-edit/models")) return new Promise<Response>(resolve => {
      finishModels = () => resolve(json({ models: [{ id: "nano-banana-pro", label: "Nano Banana" }] }));
    });
    if (url.includes("/api/image-batch-groups")) return new Promise<Response>((resolve, reject) => {
      finishHistory.push(() => resolve(json({ groups: [], hasMore: false })));
      failHistory.push(() => reject(new Error("History offline")));
    });
    if (url.includes("/api/image-batches")) return Promise.resolve(json({ batch }));
    throw new Error(`Unexpected request: ${url} ${init?.method || "GET"}`);
  });
  vi.stubGlobal("fetch", request);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});

it("keeps editing available when history fails without opening a blocking dialog", async () => {
  await act(async () => { root.render(React.createElement(BatchWorkbenchPage)); });
  await act(async () => { finishModels?.(); });
  await act(async () => { failHistory.forEach(fail => fail()); });
  expect(host.querySelector("textarea")?.disabled).toBe(false);
  expect(host.querySelector('[role="dialog"]')).toBeNull();
});
afterEach(async () => {
  await act(async () => { root.unmount(); });
  host.remove();
  vi.useRealTimers(); vi.unstubAllGlobals();
});

it("opens the real editable form before either history response and preserves edits when they arrive", async () => {
  await act(async () => { root.render(React.createElement(BatchWorkbenchPage)); });
  expect(host.querySelector("textarea")).toBeNull();
  await act(async () => { finishModels?.(); });
  expect(finishHistory).toHaveLength(2);
  const editor = host.querySelector("textarea")!;
  expect(editor).not.toBeNull();
  expect(editor.disabled).toBe(false);
  expect(mocks.panel.models).toHaveLength(1);
  await act(async () => {
    editor.value = "在历史加载期间输入的内容";
    Simulate.change(editor);
  });
  expect(editor.value).toBe("在历史加载期间输入的内容");
  await act(async () => { finishHistory.forEach(finish => finish()); });
  expect(host.querySelector("textarea")!.value).toBe("在历史加载期间输入的内容");
});
