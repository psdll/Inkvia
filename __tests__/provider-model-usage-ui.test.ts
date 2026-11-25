import { readChineseUiSource as readFileSync } from "./helpers/chinese-ui-source";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("provider model usage UI", () => {
  it("groups provider models by capability and blocks unsupported upstream selections", () => {
    const usageGroups = readFileSync(resolve(process.cwd(), "components/admin/ProviderModelUsageGroups.tsx"), "utf8");
    const llmUsageTags = readFileSync(resolve(process.cwd(), "components/admin/ProviderLlmUsageTags.tsx"), "utf8");
    const providersPanel = readFileSync(resolve(process.cwd(), "components/admin/ProvidersPanel.tsx"), "utf8");
    const modal = readFileSync(resolve(process.cwd(), "components/admin/ProviderModelsModal.tsx"), "utf8");

    expect(usageGroups).toContain("生图模型");
    expect(usageGroups).toContain("聊天模型");
    expect(usageGroups).toContain("视频模型");
    expect(usageGroups).toContain("音频模型");
    expect(usageGroups).toContain("创作");
    expect(usageGroups).toContain("批量");
    expect(usageGroups).toContain("画布");
    expect(usageGroups).not.toContain("在线生图");
    expect(usageGroups).not.toContain("画布生图节点");
    expect(usageGroups).not.toContain("视频工具");
    expect(usageGroups).not.toContain("画布视频节点");
    expect(providersPanel).toContain("<ProviderModelUsageGroups");
    expect(providersPanel).toContain("const showModelUsage = showModelFetch || hasConfiguredProviderModels(row);");
    expect(providersPanel).toContain("{showModelUsage ? (");
    expect(providersPanel.indexOf("<ProviderModelUsageGroups")).toBeGreaterThan(
      providersPanel.indexOf('<ModelCount label="LLM"'),
    );
    expect(modal).toContain("需接入适配器");
    expect(modal).toContain("disabled={!mutationAllowed || lockedBuiltin || (!selected && !adapterBacked)}");
    expect(usageGroups).toContain("<FrostedSelect");
    expect(usageGroups).toContain("var(--panel-bg)");
    expect(usageGroups).toContain("var(--input-bg)");
    expect(usageGroups).toContain("var(--border)");
    expect(usageGroups).toContain('placeholder={chatModelOptions.length ? "\u9009\u62e9\u62c9\u53d6\u5230\u7684 LLM \u6a21\u578b" : "\u8bf7\u5148\u62c9\u53d6\u6a21\u578b"}');
    expect(usageGroups).not.toContain("\u624b\u52a8\u8f93\u5165\u804a\u5929\u6a21\u578b ID");
    expect(usageGroups).not.toMatch(/<select(?:\s|>)/);
    expect(providersPanel).not.toContain("\u9996\u4e2a\u804a\u5929\u6a21\u578b ID");
    expect(providersPanel).toContain("var(--panel-bg)");
    expect(providersPanel).toContain("var(--input-bg)");
    expect(providersPanel).toContain("var(--border)");
    expect(providersPanel).not.toMatch(/(?:zinc-|slate-|white\/|black\/)/);
    expect(providersPanel).toContain("const patchProviderModels");
    expect(providersPanel.match(/patchProviderModels\(row\.id/g)).toHaveLength(5);
    expect(providersPanel).toContain("patchProviderModels(modelModal.providerId");
    expect(usageGroups).toContain("<ProviderLlmUsageTags");
    expect(usageGroups).toContain("待保存");
    expect(usageGroups).toContain("已接入");
    expect(usageGroups).toContain("disabled={routesDisabled}");
    expect(usageGroups).toContain("draftBindings={routeDrafts}");
    expect(usageGroups).toContain("allowDraftSelection={!saved}");
    expect(llmUsageTags).not.toContain("Agent LLM");
    expect(llmUsageTags).toContain('const HIDDEN_INLINE_SCENARIOS = new Set(["agent.chat", "canvas.chat"]);');
    expect(llmUsageTags).toContain("scenarios.filter(scenario => !HIDDEN_INLINE_SCENARIOS.has(scenario.id))");
    expect(llmUsageTags).not.toContain("API Key");
    expect(llmUsageTags).not.toContain("BaseURL");
    expect(llmUsageTags).not.toMatch(/(?:dark:|zinc-|slate-|white\/|black\/)/);
  });
});
