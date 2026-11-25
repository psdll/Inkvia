import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ProviderModelUsageGroups } from "@/components/admin/ProviderModelUsageGroups";
import { getBuiltinProviders, mergeSavedProvidersWithBuiltins } from "@/lib/providers/registry";
import { isBuiltinProviderModel } from "@/lib/providers/model-availability";
import { sanitizeSingleProviderAdminInput } from "@/lib/providers/admin-config";

describe("builtin provider model removal protection", () => {
  it.each(getBuiltinProviders().map(provider => [provider.id, provider] as const))(
    "%s protects every builtin kind while fetched additions stay removable after save/reload",
    (_id, baseline) => {
      const provider = { ...baseline, baseUrl: baseline.baseUrl || "https://provider.example.test/v1" };
      for (const [kind, field] of [["chat", "chatModels"], ["image", "imageModels"], ["video", "videoModels"], ["audio", "audioModels"]] as const) {
        for (const model of provider[field] ?? []) {
          const next = { ...provider, [field]: (provider[field] ?? []).filter(id => id !== model) };
          expect(() => sanitizeSingleProviderAdminInput(next, [provider]), `${provider.id}/${kind}/${model}`)
            .toThrow("不能移除");
        }
        const fetched = `fetched-${kind}`;
        const saved = { ...provider, [field]: [...(provider[field] ?? []), fetched] };
        expect(isBuiltinProviderModel(provider.id, kind, fetched)).toBe(false);
        const result = sanitizeSingleProviderAdminInput(provider, [saved]);
        const reloaded = mergeSavedProvidersWithBuiltins([result]).find(p => p.id === provider.id)!;
        expect(reloaded[field]).not.toContain(fetched);
        for (const model of provider[field] ?? []) expect(reloaded[field]).toContain(model);
      }
    },
  );

  it("recognizes every registered builtin model with the correct provider and kind", () => {
    for (const provider of getBuiltinProviders()) {
      for (const [kind, field] of [["chat", "chatModels"], ["image", "imageModels"], ["video", "videoModels"], ["audio", "audioModels"]] as const) {
        for (const model of provider[field] ?? []) {
          expect(isBuiltinProviderModel(provider.id, kind, model), `${provider.id}/${kind}/${model}`).toBe(true);
          expect(isBuiltinProviderModel("custom-other", kind, model)).toBe(false);
        }
      }
    }
  });

  it.each([true, false])("hides builtin removal while keeping fetched model removal (compact=%s)", (compact) => {
    const html = renderToStaticMarkup(React.createElement(ProviderModelUsageGroups, {
      compact, providerId: "volcengine", imageModels: [], videoModels: [],
      chatModels: ["doubao-seed-evolving", "fetched-chat"],
      savedChatModels: ["doubao-seed-evolving", "fetched-chat"],
      chatModelDraft: "", chatModelOptions: [], canManageChat: true,
      scenarios: [], routeActions: {}, routesDisabled: false, mutationsDisabled: false,
      onChatModelDraftChange: () => {}, onAddChatModel: () => {},
      onActivateRoute: () => {}, onRemove: () => {},
    }));
    expect(html).not.toContain('aria-label="移除聊天模型 doubao-seed-evolving"');
    expect(html).toContain('aria-label="移除聊天模型 fetched-chat"');
  });

  it("rejects removing an existing builtin even when bypassing the UI", () => {
    const provider = getBuiltinProviders().find(p => p.id === "volcengine")!;
    expect(() => sanitizeSingleProviderAdminInput({ ...provider, chatModels: [] }, [provider]))
      .toThrow("内置模型 doubao-seed-evolving 不能移除");
  });

  it("protects existing builtin media models too", () => {
    const provider = getBuiltinProviders().find(p => p.id === "kie")!;
    expect(() => sanitizeSingleProviderAdminInput({ ...provider, imageModels: [] }, [provider]))
      .toThrow("不能移除");
  });

  it("allows removing fetched additions and changing a builtin platform's enabled state", () => {
    const provider = getBuiltinProviders().find(p => p.id === "volcengine")!;
    const saved = { ...provider, chatModels: [...provider.chatModels, "fetched-chat"] };
    const result = sanitizeSingleProviderAdminInput({ ...provider, enabled: false }, [saved]);
    expect(result.chatModels).toEqual(["doubao-seed-evolving"]);
    expect(result.enabled).toBe(false);
  });
});
