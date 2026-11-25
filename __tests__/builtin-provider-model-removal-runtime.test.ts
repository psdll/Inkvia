// @vitest-environment jsdom
import React from "react";
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProviderModelUsageGroups } from "@/components/admin/ProviderModelUsageGroups";
import { ProviderModelsModal } from "@/components/admin/ProviderModelsModal";
import { getBuiltinProviders } from "@/lib/providers/registry";

let host: HTMLDivElement;
let root: Root;
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

describe.each(getBuiltinProviders().map(provider => [provider.id, provider] as const))("%s model controls", (_id, provider) => {
  it.each([true, false])("only renders working removal buttons for fetched models (compact=%s)", async compact => {
    const onRemove = vi.fn();
    await act(async () => root.render(React.createElement(ProviderModelUsageGroups, {
      compact, providerId: provider.id,
      imageModels: [...provider.imageModels, "fetched-image"],
      videoModels: [...provider.videoModels, "fetched-video"],
      audioModels: [...(provider.audioModels ?? []), "fetched-audio"],
      chatModels: [...provider.chatModels, "fetched-chat"],
      savedChatModels: [...provider.chatModels, "fetched-chat"],
      chatModelDraft: "", chatModelOptions: [], canManageChat: true,
      scenarios: [], routeActions: {}, routesDisabled: false, mutationsDisabled: false,
      onChatModelDraftChange: () => {}, onAddChatModel: () => {}, onActivateRoute: () => {}, onRemove,
    })));
    const removeButtons = [...host.querySelectorAll<HTMLButtonElement>('button[aria-label^="移除"]')];
    expect(removeButtons).toHaveLength(4);
    for (const button of removeButtons) {
      expect(button.getAttribute("aria-label")).toContain("fetched-");
      expect(button.disabled).toBe(false);
      await act(async () => button.click());
    }
    for (const kind of ["image", "video", "audio", "chat"]) {
      expect(onRemove).toHaveBeenCalledWith(kind, `fetched-${kind}`);
    }
  });

  it("keeps builtin selections locked and applies fetched-model removal in the fetch dialog", async () => {
    const onConfirm = vi.fn();
    const selected = { image: provider.imageModels, video: provider.videoModels, chat: [...provider.chatModels, "fetched-chat"] };
    await act(async () => root.render(React.createElement(ProviderModelsModal, {
      providerId: provider.id, providerName: provider.name,
      fetchedModels: { image: [], video: [], chat: ["fetched-chat"] }, selectedModels: selected,
      supportsLlm: true, mutationsDisabled: false, canMutateDraft: () => true,
      onClose: () => {}, onConfirm,
    })));
    const locked = [...host.querySelectorAll<HTMLButtonElement>('button[title="内置模型不能移除"]')];
    expect(locked).toHaveLength(new Set(provider.imageModels).size + new Set(provider.videoModels).size + new Set(provider.chatModels).size);
    for (const button of locked) {
      expect(button.disabled).toBe(true);
      await act(async () => button.click());
    }
    const fetched = [...host.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent?.includes("fetched-chat"))!;
    expect(fetched.disabled).toBe(false);
    await act(async () => fetched.click());
    const confirm = [...host.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent === "应用到模型列表")!;
    await act(async () => confirm.click());
    expect(onConfirm).toHaveBeenCalledWith({ image: provider.imageModels, video: provider.videoModels, chat: provider.chatModels });
  });
});
