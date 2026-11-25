/** @vitest-environment ./__tests__/jsdom-no-canvas-environment.ts */
import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ save: vi.fn(async () => true) }));
vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => ({ user: { id: 1 }, loading: false }) }));
vi.mock("@/hooks/use-role-skill-catalog", () => ({ useRoleSkillCatalog: () => ({ skills: [] }) }));
vi.mock("@/hooks/use-live-video-batch-workspace", () => ({ useLiveVideoBatchWorkspace: () => ({
  batches: [{ id: "live", name: "原分组", createdAt: "2026-10-13", items: [], videoSettings: {} }],
  pendingMedia: [], pendingActions: new Set(), models: [], settings: {}, updateBatchName: mocks.save,
}) }));
vi.mock("@/components/layout/atomic-page-reveal", () => ({ AtomicPageReveal: ({ children }: any) => children }));
vi.mock("@/components/batch-workbench/batch-media-gallery", () => ({ BatchMediaGallery: () => null }));
vi.mock("@/components/batch-workbench/live-video-parameter-dock", () => ({ LiveVideoParameterDock: () => null }));
vi.mock("@/components/role-skills/role-skill-dialog", () => ({ RoleSkillDialog: () => null }));
vi.mock("@/components/role-skills/role-skill-trigger", () => ({ RoleSkillTrigger: () => null }));
vi.mock("@/components/ui/expandable-prompt-textarea", () => ({ ExpandablePromptTextarea: () => null }));
vi.mock("@/components/ui/frosted-select", () => ({ FrostedSelect: () => null }));
vi.mock("@/components/ui/confirm-dialog", () => ({ ConfirmDialog: () => null }));
import { LiveVideoBatchWorkspace } from "@/components/batch-workbench/live-video-batch-workspace";
import { BatchResultRegistryProvider, useBatchResultRegistryState } from "@/components/batch-workbench/batch-result-registry";

function Results() {
  const { sources } = useBatchResultRegistryState();
  return React.createElement(React.Fragment, null, sources.flatMap(s => s.entries.map(e =>
    React.createElement(React.Fragment, { key: e.key }, e.content))));
}
let host: HTMLDivElement, root: Root;
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.save.mockClear();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(React.createElement(BatchResultRegistryProvider, null,
    React.createElement(LiveVideoBatchWorkspace, { onModeChange: vi.fn() }), React.createElement(Results))));
  await act(async () => (host.querySelector('[aria-label="编辑分组名称"]') as HTMLButtonElement).click());
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

it.each([{ isComposing: true }, { keyCode: 229 }])("keeps focus and candidates on IME Enter: %j", async ime => {
  const input = host.querySelector('input[aria-label="分组名称"]') as HTMLInputElement;
  const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true, ...ime });
  await act(async () => { input.dispatchEvent(event); });
  expect(event.defaultPrevented).toBe(false);
  expect(document.activeElement).toBe(input);
  expect(mocks.save).not.toHaveBeenCalled();
});

it("does not restore the old value before the registry publishes the new input", async () => {
  const input = host.querySelector('input[aria-label="分组名称"]') as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "zhong");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(input.value).toBe("zhong");
  });
});

it("keeps composition active on Enter and Escape, then saves committed Chinese once", async () => {
  const input = host.querySelector('input[aria-label="分组名称"]') as HTMLInputElement;
  await act(async () => {
    input.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    for (const key of ["Enter", "Escape"]) {
      input.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
    }
  });
  expect(host.querySelector('input[aria-label="分组名称"]')).toBe(input);
  expect(document.activeElement).toBe(input);
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "中文分组");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new CompositionEvent("compositionend", { data: "中文分组", bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  });
  expect(mocks.save).toHaveBeenCalledOnce();
  expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ id: "live" }), "中文分组");
});
