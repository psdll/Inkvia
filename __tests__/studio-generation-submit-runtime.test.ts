import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ephemeralInputDraftRegistry } from "@/lib/ephemeral-input-draft";
import { insertMediaItem } from "@/lib/media-item-order";
import { createPendingToolMediaItem, createPendingToolMediaReplacement, type ToolMediaClientItem } from "@/lib/tool-media/client-draft";

const mocks = vi.hoisted(() => ({
  patchDraft: vi.fn(),
  fetchDraft: vi.fn(),
  logAction: vi.fn(),
  setHistoryFocusId: vi.fn(),
  roleDraft: {
    systemPrompt: "", reversePrompt: "", reversePromptApplied: false,
    activeReverseTaskId: null, continuation: null, selectedRoleSkillId: null,
    resultRoleSkill: null, hydrated: true, saveError: null,
    setSystemPrompt: vi.fn(), setReversePrompt: vi.fn(),
    setReversePromptApplied: vi.fn(), setActiveReverseTaskId: vi.fn(),
    setResultRoleSkill: vi.fn(), saveNow: vi.fn(),
  },
  user: { id: "submit-race-user" },
  uploadProps: null as any,
  upload: vi.fn(),
  release: vi.fn(),
  videoModel: "doubao-seedance-2-0-260128",
  videoModels: [] as string[],
  videoModelSelect: null as any,
  importMedia: vi.fn(),
  skills: [],
  history: {
    exportAll: vi.fn(), reload: vi.fn(),
    addPendingItems: vi.fn(() => ["temp-image"]), addPendingItem: vi.fn(() => "temp-video"),
    resolvePendingItem: vi.fn(), removePendingItem: vi.fn(), failPendingItem: vi.fn(),
  },
}));

vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => ({ user: mocks.user, loading: false, openLoginModal: vi.fn() }),
}));
// Keep a legacy adapter fixture to exercise material migration after catalog retirement.
// Actual model availability and retirement are covered by provider-model-availability.test.ts.
vi.mock("@/lib/sora2", async (original) => {
  const actual = await original<typeof import("@/lib/sora2")>();
  return { ...actual, sora2Models: [...actual.sora2Models, actual.getVideoModelSpec("gemini-omni-video")] };
});
vi.mock("@/hooks/use-logger", () => ({ useLogger: () => ({ logAction: mocks.logAction }) }));
vi.mock("@/hooks/use-account-role-positioning-draft", () => ({ useAccountRolePositioningDraft: () => mocks.roleDraft }));
vi.mock("@/hooks/use-role-skill-catalog", () => ({ useRoleSkillCatalog: () => ({ skills: mocks.skills, loading: false, error: null }) }));
vi.mock("@/lib/hooks/use-generation-running", () => ({ useGenerationRunning: () => false }));
vi.mock("@/lib/hooks/use-generate-hotkey", () => ({ useGenerateHotkey: () => "Ctrl+Enter" }));
vi.mock("@/lib/tool-workspace-draft/client", async (original) => ({
  ...await original<typeof import("@/lib/tool-workspace-draft/client")>(),
  fetchToolWorkspaceDraft: mocks.fetchDraft,
  patchToolWorkspaceDraft: mocks.patchDraft,
}));
vi.mock("next/dynamic", async () => {
  const React = await import("react");
  return { default: (loader: () => unknown) => loader.toString().includes("prompt-rich-editor")
    ? (props: any) => React.createElement("textarea", {
      "data-testid": "prompt", value: props.value, onKeyDown: props.onKeyDown,
      onChange: (event: any) => props.onValueChange(event.target.value),
    })
    : () => null };
});
vi.mock("@/components/ui/prompt-rich-editor", async () => {
  const React = await import("react");
  return { PromptRichEditor: (props: any) => React.createElement("textarea", {
    "data-testid": "prompt", value: props.value, onKeyDown: props.onKeyDown,
    onChange: (event: any) => props.onValueChange(event.target.value),
  }) };
});
vi.mock("@/components/layout/tool-shell", () => ({ ToolShell: () => null }));
vi.mock("@/components/history/unified-history-panel", () => ({ UnifiedHistoryPanel: () => null }));
vi.mock("@/components/history/unified-history-actions", () => ({ UnifiedHistoryActions: () => null }));
vi.mock("@/components/ui/multi-upload-dropzone", () => ({ MultiUploadDropzone: (props: any) => {
  mocks.uploadProps = props;
  return null;
} }));
vi.mock("@/components/ui/frosted-select", () => ({ FrostedSelect: (props: any) => {
  if (props.ariaLabel === "模型") mocks.videoModelSelect = props;
  return null;
} }));
vi.mock("@/components/media-library/media-library-panel", () => ({ MediaLibraryPanel: () => null }));
vi.mock("@/components/ui/media-lightbox", () => ({ MediaLightbox: () => null }));
vi.mock("@/components/ui/confirm-dialog", () => ({ ConfirmDialog: () => null }));
vi.mock("@/components/presets/preset-prompts", () => ({ PresetPromptsTrigger: () => null }));
vi.mock("@/components/role-skills/role-skill-dialog", () => ({ RoleSkillDialog: () => null }));
vi.mock("@/components/role-skills/role-skill-trigger", () => ({ RoleSkillTrigger: () => null }));

import ImageTool from "@/app/image/image-tool";
import VideoTool from "@/app/video/video-tool";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

let root: Root;
let host: HTMLDivElement;
let request: ReturnType<typeof vi.fn>;
const response = () => new Response(JSON.stringify({ success: true, data: { generationId: "test-generation", taskId: "test-task" } }));

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  localStorage.clear();
  sessionStorage.clear();
  mocks.patchDraft.mockReset().mockImplementation(async (tool, input) => ({
    id: "test-draft", tool, schemaVersion: 1, version: input.expectedVersion + 1,
    payload: input.payload, media: [], updatedAt: new Date().toISOString(),
  }));
  mocks.fetchDraft.mockReset().mockImplementation(async (tool) => ({
    id: "test-draft", tool, schemaVersion: 1, version: 1, media: [],
    payload: { schemaVersion: 1, tool, state: tool === "video" ? { inputMode: "text_to_video" } : {} },
    updatedAt: new Date().toISOString(),
  }));
  mocks.logAction.mockReset();
  mocks.setHistoryFocusId.mockReset();
  mocks.uploadProps = null;
  mocks.videoModel = "doubao-seedance-2-0-260128";
  mocks.videoModels = [];
  mocks.videoModelSelect = null;
  mocks.importMedia.mockReset();
  mocks.upload.mockReset();
  mocks.release.mockReset().mockResolvedValue(new Response(JSON.stringify({ success: true })));
  Object.values(mocks.history).forEach(mock => mock.mockClear());
  request = vi.fn().mockImplementation(async () => response());
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "/api/image-edit" || url === "/api/video-gen") return request(url, init);
    if (url === "/api/tool-media/upload") return mocks.upload(init);
    if (url === "/api/assets/import") return mocks.importMedia(init);
    if (url === "/api/tool-media/release") return mocks.release(init);
    if (url === "/api/image-edit/models") return new Response(JSON.stringify({ models: [{ id: "nano-banana-pro", label: "nano-banana-pro" }] }));
    if (url === "/api/toolbox/models?category=video") return new Response(JSON.stringify({ success: true, models: (mocks.videoModels.length ? mocks.videoModels : [mocks.videoModel]).map(id => ({ id })) }));
    if (url.startsWith("/api/prompt-reverse?")) return new Response(JSON.stringify({ success: true, items: [] }));
    throw new Error(`Unexpected request: ${url}`);
  }));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  ephemeralInputDraftRegistry.clearOwner(mocks.user.id);
  host.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

async function mount(tool: "image" | "video", items: ToolMediaClientItem[] = [], strict = false) {
  ephemeralInputDraftRegistry.write(`toolbox:${tool}`, mocks.user.id, {
    prompt: "A regression test prompt", items, draftSessionId: "11111111-1111-4111-8111-111111111111",
  });
  const props = {
    embeddedInStudioShell: true,
    studioNav: { activeTool: tool, onSelectTool: vi.fn() },
    sharedHistory: {
      historyRef: { current: mocks.history }, historyFocusId: null, historyCount: 0,
      setHistoryFocusId: mocks.setHistoryFocusId, setHistoryCount: vi.fn(),
    },
  };
  const element = React.createElement<NonNullable<Parameters<typeof ImageTool>[0]>>(
    tool === "image" ? ImageTool : VideoTool,
    props,
  );
  await act(async () => root.render(strict ? React.createElement(React.StrictMode, null, element) : element));
  const button = Array.from(host.querySelectorAll("button")).find((item) => item.textContent?.trim() === "生成");
  expect(button, host.textContent || "").toBeDefined();
  expect(button!.disabled).toBe(false);
  return button!;
}

async function settleSubmission() {
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
}

describe.each(["image", "video"] as const)("%s studio submission", (tool) => {
  it("reconciles the submitted task without requesting history navigation on acknowledgement", async () => {
    const submitted = deferred<Response>();
    request.mockImplementationOnce(() => submitted.promise);
    const button = await mount(tool);
    await act(async () => button.click());
    await settleSubmission();
    expect(mocks.history.resolvePendingItem).not.toHaveBeenCalled();
    await act(async () => submitted.resolve(response()));
    expect(mocks.history.resolvePendingItem).toHaveBeenCalledWith(`temp-${tool}`, "test-generation");
    expect(mocks.history.reload).toHaveBeenCalled();
    expect(mocks.setHistoryFocusId).not.toHaveBeenCalled();
  });

  it("preserves history navigation when the submitted task is stored as a failure", async () => {
    const submitted = deferred<Response>();
    request.mockImplementationOnce(() => submitted.promise);
    const button = await mount(tool);
    await act(async () => button.click());
    await settleSubmission();
    await act(async () => submitted.resolve(new Response(JSON.stringify({
      success: false, displayInHistory: true,
      data: { generationId: "failed-generation" },
    }), { status: 500 })));
    expect(mocks.history.resolvePendingItem).toHaveBeenCalledWith(`temp-${tool}`, "failed-generation");
    expect(mocks.history.reload).toHaveBeenCalled();
    expect(mocks.setHistoryFocusId).not.toHaveBeenCalled();
    expect(button.disabled).toBe(false);
  });

  it.each(["before", "after"] as const)("submits inserted %s order to the backend without releasing materials", async (placement) => {
    mocks.videoModel = "minimax-h3";
    mocks.fetchDraft.mockImplementation(async () => ({
      id: "test-draft", tool, schemaVersion: 1, version: 1, media: [],
      payload: { schemaVersion: 1, tool, state: tool === "video" ? { model: "minimax-h3", inputMode: "multimodal" } : {} },
    }));
    const ids = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222", "33333333-3333-4333-8333-333333333333"];
    const items: ToolMediaClientItem[] = ids.map((mediaId) => ({
      mediaId, file: null, url: `/uploads/imports/${mediaId}.png`, uploadState: "ready", kind: "image",
    }));
    const button = await mount(tool, items, true);
    await act(async () => mocks.uploadProps.onItemsChange(insertMediaItem(mocks.uploadProps.items, 0, 2, placement)));
    await act(async () => button.click());
    await settleSubmission();
    expect(request).toHaveBeenCalledOnce();
    expect(request.mock.calls[0][0]).toBe(tool === "image" ? "/api/image-edit" : "/api/video-gen");
    const form = request.mock.calls[0][1].body as FormData;
    const expectedIds = placement === "before" ? [ids[1], ids[0], ids[2]] : [ids[1], ids[2], ids[0]];
    expect(form.getAll("toolMediaId[]")).toEqual(expectedIds);
    expect(JSON.parse(String(form.get("inputManifest")))).toEqual({
      version: 1, items: expectedIds.map((mediaId, position) => ({ position, source: "tool_media", mediaId })),
    });
    expect(mocks.release).not.toHaveBeenCalled();
  });

  it("populates the pending task from the submitted prompt and settings before the response", async () => {
    const submitted = deferred<Response>();
    request.mockImplementationOnce(() => submitted.promise);
    const button = await mount(tool);
    await act(async () => button.click());
    await settleSubmission();
    const form = request.mock.calls[0][1].body as FormData;
    const addPending = tool === "image" ? mocks.history.addPendingItems : mocks.history.addPendingItem;
    const args = addPending.mock.calls[0] as unknown as any[];
    const metadata = tool === "image" ? args[0] : args[2];
    expect(metadata).toMatchObject({ prompt: form.get("prompt"), model: form.get("model") });
    expect(metadata.params.resolution).toBe(form.get("resolution"));
    expect(metadata.params[tool === "image" ? "aspectRatio" : "ratio"]).toBe(form.get(tool === "image" ? "aspectRatio" : "ratio"));
    expect(addPending.mock.invocationCallOrder[0]).toBeLessThan(request.mock.invocationCallOrder[0]);
    expect(mocks.history.resolvePendingItem).not.toHaveBeenCalled();
    await act(async () => submitted.resolve(response()));
  });

  it("shows busy feedback before a slow draft save completes", async () => {
    const save = deferred<any>();
    mocks.patchDraft.mockImplementationOnce(() => save.promise);
    const button = await mount(tool);
    await act(async () => button.click());
    expect(mocks.patchDraft).toHaveBeenCalledOnce();
    expect(button.disabled).toBe(true);
    expect(button.textContent).toContain("正在检查素材");
    expect(request).not.toHaveBeenCalled();
    await act(async () => save.resolve({ version: 2 }));
    await settleSubmission();
  });

  it("submits only once after rapid clicks during a slow draft save", async () => {
    const save = deferred<any>();
    mocks.patchDraft.mockImplementationOnce(() => save.promise);
    const button = await mount(tool);
    await act(async () => { button.click(); button.click(); });
    await act(async () => button.click());
    expect(request).not.toHaveBeenCalled();
    await act(async () => save.resolve({ version: 2 }));
    await settleSubmission();
    expect(request).toHaveBeenCalledOnce();
    expect(button.disabled).toBe(false);
  });

  it("unlocks after a failed draft save and allows an explicit retry", async () => {
    const save = deferred<any>();
    mocks.patchDraft.mockImplementationOnce(() => save.promise);
    const button = await mount(tool);
    await act(async () => button.click());
    await act(async () => save.reject(new Error("保存草稿失败，请重试")));
    expect(button.disabled).toBe(false);
    expect(button.textContent?.trim()).toBe("生成");
    expect(host.textContent).toContain("保存草稿失败");
    expect(request).not.toHaveBeenCalled();
    await act(async () => button.click());
    await settleSubmission();
    expect(request).toHaveBeenCalledOnce();
  });

  it("shares the submit lock between the button and the prompt hotkey", async () => {
    const save = deferred<any>();
    mocks.patchDraft.mockImplementationOnce(() => save.promise);
    const button = await mount(tool);
    const editor = host.querySelector<HTMLTextAreaElement>('[data-testid="prompt"]')!;
    expect(editor).not.toBeNull();
    await act(async () => {
      editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true }));
      button.click();
      editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true }));
    });
    expect(mocks.patchDraft).toHaveBeenCalledOnce();
    await act(async () => save.resolve({ version: 2 }));
    await settleSubmission();
    expect(request).toHaveBeenCalledOnce();
    expect(button.disabled).toBe(false);
  });

  it("blocks clicks until the submit response, then allows a separate task", async () => {
    const submitted = deferred<Response>();
    request.mockImplementationOnce(() => submitted.promise);
    const button = await mount(tool);
    await act(async () => button.click());
    await settleSubmission();
    expect(request).toHaveBeenCalledOnce();
    expect(button.disabled).toBe(true);
    expect(button.textContent).toContain("正在提交模型");
    await act(async () => button.click());
    expect(request).toHaveBeenCalledOnce();
    await act(async () => submitted.resolve(response()));
    expect(button.disabled).toBe(false);
    await act(async () => button.click());
    await settleSubmission();
    expect(request).toHaveBeenCalledTimes(2);
    const keys = request.mock.calls.map(([, init]) => init.body.get("requestKey"));
    expect(keys[0]).toBeTruthy();
    expect(keys[1]).toBeTruthy();
    expect(keys[0]).not.toBe(keys[1]);
  });
});

describe("video model changes with uploaded materials", () => {
  const managedId = "22222222-2222-4222-8222-222222222222";
  const importedId = "33333333-3333-4333-8333-333333333333";
  const managed: ToolMediaClientItem = { mediaId: managedId, file: null, url: "/uploads/imports/managed.png", uploadState: "ready", kind: "image" };
  const legacy: ToolMediaClientItem = { file: null, url: "/uploads/imports/legacy.png", uploadState: "ready" };

  beforeEach(() => {
    mocks.videoModels = ["gemini-omni-video", "minimax-h3", "doubao-seedance-2-0-260128"];
    localStorage.setItem(`studio_seedance_face_notice_v1_${mocks.user.id}_doubao-seedance-2-0-260128`, "acknowledged");
    mocks.fetchDraft.mockImplementation(async () => ({
      id: "test-draft", tool: "video", schemaVersion: 1, version: 1, media: [],
      payload: { schemaVersion: 1, tool: "video", state: { model: "gemini-omni-video", inputMode: "multimodal" } },
    }));
    mocks.upload.mockImplementation(async () => new Response(JSON.stringify({
      mediaId: importedId, status: "ready", kind: "image", localPreviewUrl: "/uploads/imports/registered.png",
      modelUrl: "/uploads/imports/registered.png", sizeBytes: 1024,
    })));
  });

  async function switchModel(model: string) {
    const params = Array.from(host.querySelectorAll("button")).find(button => button.textContent?.startsWith("参数设置"))!;
    if (!mocks.videoModelSelect) await act(async () => params.click());
    await act(async () => mocks.videoModelSelect.onChange(model));
    await act(async () => vi.advanceTimersByTimeAsync(50));
  }

  it.each(["minimax-h3", "doubao-seedance-2-0-260128"])("registers ready legacy materials after switching to %s", async (model) => {
    const button = await mount("video", [legacy, managed], true);
    expect(mocks.upload).not.toHaveBeenCalled();
    await switchModel(model);
    expect(mocks.upload).toHaveBeenCalledOnce();
    const form = mocks.upload.mock.calls[0][0].body as FormData;
    expect(form.get("sourceUrl")).toBe(legacy.url);
    expect(form.get("model")).toBe(model);
    expect(mocks.uploadProps.items.map((item: ToolMediaClientItem) => item.mediaId)).toEqual([importedId, managedId]);
    expect(button.disabled).toBe(false);
    expect(button.textContent).toBe("生成");
    await switchModel(model === "minimax-h3" ? "doubao-seedance-2-0-260128" : "minimax-h3");
    expect(mocks.upload).toHaveBeenCalledOnce();
    expect(button.disabled).toBe(false);
    expect(mocks.release).not.toHaveBeenCalled();
  });

  it("finishes registration when the model changes during a legacy import", async () => {
    const imported = deferred<Response>();
    mocks.importMedia.mockImplementationOnce(() => imported.promise);
    const button = await mount("video", [managed]);
    await act(async () => mocks.uploadProps.onItemsChange([{ file: null, url: "/uploads/image_results/source.png" }, managed]));
    expect(mocks.importMedia).toHaveBeenCalledOnce();
    await switchModel("minimax-h3");
    expect(mocks.upload).not.toHaveBeenCalled();
    await act(async () => imported.resolve(new Response(JSON.stringify({ success: true, data: { localPath: legacy.url } }))));
    await act(async () => vi.advanceTimersByTimeAsync(50));
    expect(mocks.upload).toHaveBeenCalledOnce();
    expect(mocks.uploadProps.items.map((item: ToolMediaClientItem) => item.mediaId)).toEqual([importedId, managedId]);
    expect(button.disabled).toBe(false);
  });

  it("shows a real registration error instead of waiting indefinitely", async () => {
    mocks.upload.mockResolvedValue(new Response(JSON.stringify({ success: false, error: "素材处理失败，请重试" }), { status: 422 }));
    const button = await mount("video", [legacy]);
    await switchModel("minimax-h3");
    expect(mocks.upload).toHaveBeenCalledOnce();
    expect(mocks.uploadProps.items[0]).toMatchObject({ url: legacy.url, uploadState: "failed", uploadError: "素材处理失败，请重试" });
    expect(button.textContent).not.toContain("上传中");
    expect(button.disabled).toBe(true);
  });
});

describe("video input release follows the committed upload list", () => {
  const firstId = "22222222-2222-4222-8222-222222222222";
  const secondId = "33333333-3333-4333-8333-333333333333";
  const ready = (mediaId = firstId): ToolMediaClientItem => ({
    mediaId, file: null, url: `/uploads/imports/${mediaId}.png`, uploadState: "ready", kind: "image",
  });
  const uploaded = () => new Response(JSON.stringify({
    mediaId: secondId, localPreviewUrl: `/uploads/imports/${secondId}.png`,
    modelUrl: `/uploads/imports/${secondId}.png`, status: "ready", kind: "image",
  }));
  const change = async (items: ToolMediaClientItem[]) => {
    await act(async () => mocks.uploadProps.onItemsChange(items));
  };
  const flushUploads = async () => {
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });
  };

  beforeEach(() => {
    mocks.videoModel = "minimax-h3";
    mocks.fetchDraft.mockImplementation(async () => ({
      id: "test-draft", tool: "video", schemaVersion: 1, version: 1, media: [],
      payload: { schemaVersion: 1, tool: "video", state: { model: "minimax-h3", inputMode: "multimodal" } },
    }));
  });

  it("does not release a visible material from an intermediate StrictMode state update", async () => {
    const item = ready();
    await mount("video", [item], true);
    const onItemsChange = mocks.uploadProps.onItemsChange;
    await act(async () => {
      onItemsChange([]);
      onItemsChange([item]);
    });
    await flushUploads();
    expect(mocks.uploadProps.items).toEqual([item]);
    expect(mocks.release).not.toHaveBeenCalled();
  });

  it("rechecks a queued release after an upload when the old material is back in use", async () => {
    const item = ready();
    const upload = deferred<Response>();
    mocks.upload.mockImplementationOnce(() => upload.promise);
    await mount("video", [item]);
    await change([item, createPendingToolMediaItem(new File(["image"], "new.png", { type: "image/png" }))]);
    expect(mocks.upload).toHaveBeenCalledOnce();
    await change(mocks.uploadProps.items.slice(1));
    await change([item, ...mocks.uploadProps.items]);
    await act(async () => upload.resolve(uploaded()));
    await flushUploads();
    expect(mocks.uploadProps.items.map((entry: ToolMediaClientItem) => entry.mediaId)).toEqual([firstId, secondId]);
    expect(mocks.release).not.toHaveBeenCalled();
  });

  it("releases a replaced material only after success and preserves the replacement", async () => {
    const item = ready();
    const upload = deferred<Response>();
    mocks.upload.mockImplementationOnce(() => upload.promise);
    await mount("video", [item]);
    await change([createPendingToolMediaReplacement(item, new File(["image"], "new.png", { type: "image/png" }))]);
    expect(mocks.release).not.toHaveBeenCalled();
    await act(async () => upload.resolve(uploaded()));
    await flushUploads();
    expect(mocks.uploadProps.items[0].mediaId).toBe(secondId);
    expect(mocks.release).toHaveBeenCalledOnce();
    expect(JSON.parse(mocks.release.mock.calls[0][0].body).mediaIds).toEqual([firstId]);
  });

  it("retains the old material when replacement fails", async () => {
    const item = ready();
    const upload = deferred<Response>();
    mocks.upload.mockImplementationOnce(() => upload.promise);
    await mount("video", [item]);
    await change([createPendingToolMediaReplacement(item, new File(["image"], "new.png", { type: "image/png" }))]);
    await act(async () => upload.reject(new Error("network interrupted")));
    await flushUploads();
    expect(mocks.uploadProps.items[0]).toMatchObject({ mediaId: firstId, uploadState: "failed" });
    expect(mocks.release).not.toHaveBeenCalled();
  });

  it("keeps reordered references and only releases an explicitly removed item", async () => {
    const first = ready();
    const second = ready(secondId);
    await mount("video", [first, second], true);
    await change([second, first]);
    await flushUploads();
    expect(mocks.release).not.toHaveBeenCalled();
    await change([second]);
    await flushUploads();
    expect(mocks.release).toHaveBeenCalledOnce();
    expect(JSON.parse(mocks.release.mock.calls[0][0].body).mediaIds).toEqual([firstId]);
  });
});

it("processes restored video sources concurrently while preserving reference order", async () => {
  mocks.videoModel = "minimax-h3";
  mocks.fetchDraft.mockImplementation(async () => ({
    id: "test-draft", tool: "video", schemaVersion: 1, version: 1, media: [],
    payload: { schemaVersion: 1, tool: "video", state: { model: "minimax-h3", inputMode: "multimodal" } },
  }));
  await mount("video");
  const pending = Array.from({ length: 4 }, () => deferred<Response>());
  let calls = 0;
  mocks.upload.mockImplementation(() => pending[calls++].promise);
  const sources = Array.from({ length: 4 }, (_, i) => ({ file: null, url: `/uploads/imports/source-${i}.png` }));
  await act(async () => mocks.uploadProps.onItemsChange(sources));
  await act(async () => vi.advanceTimersByTimeAsync(50));
  expect(mocks.upload).toHaveBeenCalledTimes(3);
  const ready = (i: number) => new Response(JSON.stringify({
    mediaId: `11111111-1111-4111-8111-11111111111${i}`, status: "ready", kind: "image",
    localPreviewUrl: `/uploads/imports/ready-${i}.png`, modelUrl: `/uploads/imports/ready-${i}.png`, sizeBytes: 1024,
  }));
  await act(async () => { pending[1].resolve(ready(1)); await vi.advanceTimersByTimeAsync(50); });
  expect(mocks.upload).toHaveBeenCalledTimes(4);
  await act(async () => { [3, 2, 0].forEach(i => pending[i].resolve(ready(i))); await vi.advanceTimersByTimeAsync(100); });
  expect(mocks.uploadProps.items.map((item: ToolMediaClientItem) => item.url)).toEqual([0, 1, 2, 3].map(i => `/uploads/imports/ready-${i}.png`));
  expect(mocks.uploadProps.items.every((item: ToolMediaClientItem) => item.uploadState === "ready")).toBe(true);
});
