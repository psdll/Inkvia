import { existsSync } from "node:fs";
import { readChineseUiSource as readFileSync } from "./helpers/chinese-ui-source";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string) => {
  const absolutePath = join(root, path);
  return existsSync(absolutePath) ? readFileSync(absolutePath, "utf8") : "";
};

describe("LLM admin providers UI", () => {
  const source = read("components/admin/ProvidersPanel.tsx");
  const adminUiSource = read("lib/providers/admin-ui.ts");
  const modelUsageSource = read("components/admin/ProviderModelUsageGroups.tsx");
  const systemNavigation = read("components/admin/system-navigation.ts");
  const systemTab = read("components/admin/AdminSystemTab.tsx");

  it("uses the requested API configuration labels without the provider description", () => {
    expect(systemNavigation).toContain('{ type: "item", key: "providers", id: "sys-providers", label: "API配置" }');
    expect(source).toContain("/> API配置");
    expect(source).not.toContain("动态管理 AI 供应商");
    expect(systemTab).not.toContain('title="AI 平台 · 一键配置"');
    expect(systemTab).toMatch(/<section\s+id="sys-providers"/);
  });

  it("shows selected chat models without exposing protocol or endpoint details", () => {
    expect(source).toContain('llmProtocol?: "openai-chat"');
    expect(source).toContain("llmEndpointTemplate?: string");
    expect(source).toContain("<ProviderModelUsageGroups");
    expect(modelUsageSource).toContain("聊天模型");
    expect(modelUsageSource).toContain("models.map");
    expect(modelUsageSource).toContain("添加模型后可先选择 LLM 使用场景，再保存本平台");
    expect(modelUsageSource).toContain("移除聊天模型");
    expect(source).not.toContain("LLM 请求设置");
    expect(source).not.toContain("OpenAI Chat Completions");
    expect(source).not.toContain("endpoint 模板");
    expect(source).not.toContain("首个 LLM 模型请求预览");
    expect(source).toContain("resolveProviderLlmUiSettings");
    expect(source).toContain("getCurrentAvailableFetchedModels");
    expect(source).toContain("getState: () => modelFetchStateRef.current");
    expect(source).not.toContain("modelFetchState.revisions[row.id] ?? 0");
    expect(source).toContain("ensureProviderModelFetchRevisions");
    expect(source).not.toContain("customDraft.chatModel");
    expect(source).not.toContain("const supportsLlm = chatModels.length > 0");
  });

  it("loads and directly activates scenario routes from saved model rows", () => {
    expect(source).toContain('fetch("/api/admin/llm-routes"');
    expect(adminUiSource).toContain('`/api/admin/llm-routes/${scenarioId}/activate`');
    expect(source).toContain("runRouteActivation");
    expect(source).toContain("createProviderLlmAdminController");
    expect(source).toContain("llmAdminController.activate");
    expect(source).toContain("llmAdminController.save");
    expect(source).toContain("llmAdminController.refresh");
    expect(source).toContain("prepareSnapshots: prepareAdminSnapshots");
    expect(source).not.toContain("llmAdminController.setRevision");
    expect(source).not.toContain("reloadProviders:");
    expect(source).not.toContain("reloadRoutes:");
    expect(source).toContain("requestProviderAdminSnapshot");
    expect(source).toContain("requestProviderAdminProviderSave");
    expect(source).toContain("requestProviderAdminProxySave");
    expect(modelUsageSource).toContain("<ProviderLlmUsageTags");
    expect(source).not.toContain("LLM 场景路由");
    expect(source).not.toContain("将画布当前选择应用到两处");
  });

  it("stages route choices on the dirty provider while keeping unrelated cards blocked", () => {
    expect(source).toContain("hasUnsavedProviderChanges");
    expect(adminUiSource).toContain("先保存平台配置，再应用 LLM 模型");
    expect(source).toContain("routesDisabled={adminOperationsLocked || (hasUnsavedProviderChanges && !rowDirty)}");
    expect(source).toContain("if (rowDirty)");
    expect(source).toContain("updateRouteDrafts");
    expect(source).toContain('setControllerBusy(state.operation.kind !== "idle")');
    expect(source).toContain("disabled={adminOperationsLocked}");
    expect(source).toContain("PROVIDER_LLM_SYNC_FAILED_MESSAGE");
  });

  it("keeps save ownership and post-save sync inside the controller", () => {
    expect(source).toContain('saveResult.kind === "sync_failed"');
    expect(source).toContain("{routeSyncMessage} 点击");
    expect(source.match(/llmAdminController\.refresh\(\)/g)).toHaveLength(2);
  });

  it("saves provider cards independently instead of submitting the whole provider list", () => {
    expect(source).toContain("const saveProvider = async (row: ProviderRow)");
    expect(source).toContain("provider: row");
    expect(source).toContain("保存本平台");
    expect(source).not.toContain("const payloadProviders = providers.map");
    expect(source).not.toContain("{/* 保存栏 */}");
  });

  it("keeps the proxy address visible while editing", () => {
    expect(source).toMatch(/type="text"\s+aria-label="统一代理 URL"/);
  });

  it("announces successful inline route changes without a quick-copy action", () => {
    expect(source).toContain("runRouteActivation");
    expect(source).not.toContain("applyCanvasDraftToAll");
    expect(source).toContain("routeDrafts");
    expect(source).toContain("pendingRoutes");
    expect(source).toContain('window.dispatchEvent(new Event("llm-routes-changed"))');
  });
});

describe("LLM route overview card", () => {
  const card = read("components/admin/LlmRouteOverviewCard.tsx");
  const overview = read("components/admin/AdminOverviewTab.tsx");

  it("renders configured defaults, last calls, sources, statuses, and timestamps", () => {
    expect(card).toContain('fetch("/api/admin/llm-routes"');
    expect(card).toContain("scenario.configured");
    expect(card).toContain("scenario.effective");
    expect(card).toContain("scenario.lastCall");
    expect(card).toContain("routeSourceLabel");
    expect(card).toContain("routeStatusLabel");
    expect(card).toContain("formatRouteTime");
    expect(card).toContain("画布允许节点覆盖后台默认路由");
  });

  it("refreshes on demand and after provider route changes", () => {
    expect(card).toContain('window.addEventListener("llm-routes-changed"');
    expect(card).toContain('window.removeEventListener("llm-routes-changed"');
    expect(card).toContain("刷新");
  });

  it("is not rendered on the system overview page", () => {
    expect(overview).not.toContain("LlmRouteOverviewCard");
  });

  it("uses shared theme tokens for ordinary card surfaces", () => {
    expect(card).toContain("var(--panel-bg)");
    expect(card).toContain("var(--app-fg)");
    expect(card).toContain("var(--app-muted)");
    expect(card).toContain("var(--border)");
  });
});
