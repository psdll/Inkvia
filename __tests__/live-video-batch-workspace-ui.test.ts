import { describe, expect, it } from "vitest";

import { readChineseUiSource as readFileSync } from "./helpers/chinese-ui-source";

describe("live video batch workspace UI", () => {
  it("keeps the current workspace visible until the requested mode has revealed", () => {
    const page = readFileSync("components/batch-workbench/batch-workbench-page.tsx", "utf8");
    const liveWorkspace = readFileSync(
      "components/batch-workbench/live-video-batch-workspace.tsx",
      "utf8",
    );

    expect(page).toContain("displayedSurface");
    expect(page).toContain("requestedSurface");
    expect(page).toContain('data-workbench-surface-state={displayedSurface === "image" ? "visible" : "staging"}');
    expect(page).toContain('data-workbench-surface-state={displayedSurface === "live" ? "visible" : "staging"}');
    expect(page).toContain("onInitialReady");
    expect(liveWorkspace).toContain("onInitialReady");
    expect(page).not.toContain("if (liveVideoOpen)");
  });

  it("keeps both mode transition surfaces filling the complete workbench frame", () => {
    const page = readFileSync("components/batch-workbench/batch-workbench-page.tsx", "utf8");

    expect(page).toContain("absolute inset-0 flex h-full min-h-0 min-w-0");
    expect(page).toContain('"z-10 opacity-100"');
    expect(page).toContain('"pointer-events-none z-0 opacity-0"');
    expect(page).not.toContain("route-transition-slot");
  });

  it("adds a third mode without sending it through the image batch controller", () => {
    const page = readFileSync("components/batch-workbench/batch-workbench-page.tsx", "utf8");
    const panel = readFileSync("components/batch-workbench/batch-settings-panel.tsx", "utf8");
    expect(page).toContain("LiveVideoBatchWorkspace");
    expect(page).toContain("onOpenLiveVideo");
    expect(panel).toContain('value: "live_video"');
    expect(panel).toContain("onOpenLiveVideo");
  });

  it("uses one capped image gallery, Skill selection, and video-only settings", () => {
    const source = readFileSync(
      "components/batch-workbench/live-video-batch-workspace.tsx",
      "utf8",
    );
    expect(source.match(/<BatchMediaGallery/g)).toHaveLength(1);
    expect(source).toContain('label="图片素材"');
    expect(source).toContain("LIVE_VIDEO_BATCH_MAX_MEDIA");
    expect(source).toContain("单个分组最多上传 10 张图片");
    expect(source).toContain("RoleSkillDialog");
    expect(source).toContain("开始批量生成");
  });

  it("uses the compact prompt heading with only the Skill entry", () => {
    const source = readFileSync(
      "components/batch-workbench/live-video-batch-workspace.tsx",
      "utf8",
    );

    expect(source).toContain(
      '<span className="text-[13px] font-semibold text-[var(--app-fg)]">提示词</span>',
    );
    expect(source).toContain("ExpandablePromptTextarea");
    expect(source).not.toContain("图片分析 Skill");
    expect(source).not.toContain("公共补充要求");
    expect(source).not.toContain(
      "选择一个 Skill，系统会让它对每张图片独立分析并生成不同提示词。",
    );
  });

  it("reuses the custom-batch rich prompt with asset mentions and slash skills", () => {
    const source = readFileSync(
      "components/batch-workbench/live-video-batch-workspace.tsx",
      "utf8",
    );

    expect(source).toContain("ExpandablePromptTextarea");
    expect(source).toContain("buildBatchPromptAssets(relations)");
    expect(source).toContain("assets={promptAssets}");
    expect(source).toContain("roleSkills={skills}");
    expect(source).toContain("roleSkillsLoading={skillsLoading}");
    expect(source).toContain("roleSkillsError={skillsError}");
    expect(source).toContain(
      "onRoleSkillSelect={(skill) => controller.setSelectedSkillId(skill.id)}",
    );
    expect(source).toContain('data-live-video-role-skill-token=""');
    expect(source).not.toContain('<textarea\n                aria-label="提示词"');
  });

  it("uses upload-first guidance in the Live prompt placeholder", () => {
    const source = readFileSync(
      "components/batch-workbench/live-video-batch-workspace.tsx",
      "utf8",
    );

    expect(source).toContain(
      'placeholder="无需填写提示词，直接上传图片即可；如果上传的图片素材中有人物，请使用带 face 后缀的模型"',
    );
    expect(source).not.toContain('placeholder="无需填写提示词，上传图片直接执行"');
    expect(source).not.toContain(
      'placeholder="描述你的想法，用@引用图片作为参考，用/使用技能"',
    );
  });

  it("shows only a manual Skill override inside the prompt while keeping the effective Skill selected", () => {
    const source = readFileSync(
      "components/batch-workbench/live-video-batch-workspace.tsx",
      "utf8",
    );

    expect(source).toContain("selected={Boolean(controller.selectedSkillId)}");
    expect(source).toContain(
      "leadingToken={controller.overrideSkillId && selectedSkill ? (",
    );
    expect(source).toContain(
      "selectedRoleSkillId={controller.selectedSkillId || null}",
    );
    expect(source).toContain('onClick={() => controller.setSelectedSkillId("")}');
  });

  it("uses an isolated model and categorized parameter dock above generation", () => {
    const source = readFileSync(
      "components/batch-workbench/live-video-batch-workspace.tsx",
      "utf8",
    );
    const dock = readFileSync(
      "components/batch-workbench/live-video-parameter-dock.tsx",
      "utf8",
    );

    expect(source).toContain("<LiveVideoParameterDock");
    expect(source).toContain('variant="groupHeader"');
    expect(source).not.toContain("首帧图生视频 · 固定 4 秒 · MP4");
    expect(source).not.toContain("function GroupSettings");
    expect(source).toContain("flex min-h-24 flex-1 flex-col");
    expect(dock).toContain('type ParameterPanel = "model" | "params" | null');
    expect(dock).not.toContain('"输出模式"');
    expect(dock).not.toContain("inputModeOptions");
    expect(dock).toContain('"分辨率"');
    expect(dock).toContain('"尺寸/比例"');
    expect(dock).toContain('label: value === "adaptive" ? "自动" : value');
    expect(dock).toContain('const summaryRatio = settings.ratio === "adaptive" ? "自动" : settings.ratio');
    expect(dock).toContain('>视频时长</span>');
    expect(dock).toContain('"声音"');
    expect(dock).toContain("settings.duration");
    expect(dock).toContain("settings.generateAudio");
  });

  it("disables the isolated Live video duration slider", () => {
    const dock = readFileSync(
      "components/batch-workbench/live-video-parameter-dock.tsx",
      "utf8",
    );

    expect(dock).toContain("function DurationSlider");
    expect(dock).toContain('type="range"');
    expect(dock).toContain('aria-label="视频时长秒数"');
    expect(dock).toMatch(/type="range"[\s\S]*?\sdisabled\s[\s\S]*?aria-label="视频时长秒数"/);
    expect(dock).not.toContain("disabled={options.length <= 1}");
    expect(dock).toContain("max={Math.max(0, options.length - 1)}");
    expect(dock).toContain("onChange({ ...settings, duration })");
    expect(dock).toContain("accent-[var(--primary-bg)]");
  });

  it("shows the current Live model and parameters in the group header like custom batch", () => {
    const source = readFileSync(
      "components/batch-workbench/live-video-batch-workspace.tsx",
      "utf8",
    );

    expect(source).toContain('aria-label="当前分组生成参数"');
    expect(source).toContain("batch.items.length");
    expect(source).toContain("groupModelLabel");
    expect(source).toContain("groupRatioLabel");
    expect(source).toContain("batch.videoSettings.resolution");
    expect(source).toContain("batch.videoSettings.duration");
    expect(source).not.toContain("groupInputModeLabel");
    expect(source).toContain('batch.videoSettings.generateAudio ? "声音开" : "声音关"');
  });

  it("matches the custom-batch group action order and compact task density", () => {
    const source = readFileSync(
      "components/batch-workbench/live-video-batch-workspace.tsx",
      "utf8",
    );
    const groupHeaderStart = source.indexOf('variant="groupHeader"');
    const groupHeaderEnd = source.indexOf("{batch.items.map", groupHeaderStart);
    const groupHeader = source.slice(groupHeaderStart, groupHeaderEnd);

    expect(source).toContain(
      'import { LiveVideoTaskCard } from "@/components/batch-workbench/live-video-task-card";',
    );
    expect(source).toContain(
      "grid-cols-[repeat(auto-fill,minmax(220px,1fr))]",
    );
    expect(groupHeader.indexOf("开始批量生成")).toBeGreaterThanOrEqual(0);
    expect(groupHeader.indexOf("开始批量生成")).toBeLessThan(
      groupHeader.indexOf("删除分组"),
    );
    expect(groupHeader.indexOf("删除分组")).toBeLessThan(
      groupHeader.indexOf("下载整组视频"),
    );
    expect(readFileSync(
      "components/batch-workbench/unified-batch-results.tsx",
      "utf8",
    )).toContain("还没有批量任务");
  });

  it("matches the image modes task-group deletion confirmation copy", () => {
    const liveWorkspace = readFileSync(
      "components/batch-workbench/live-video-batch-workspace.tsx",
      "utf8",
    );
    const imageWorkspace = readFileSync(
      "components/batch-workbench/batch-workbench-page.tsx",
      "utf8",
    );
    const liveDialog = liveWorkspace.match(
      /<ConfirmDialog\s+open=\{Boolean\(deleteBatchId\)\}[\s\S]*?\/>/,
    )?.[0] || "";
    const imageDialog = imageWorkspace.match(
      /<ConfirmDialog\s+open=\{Boolean\(pendingDeleteGroup\)\}[\s\S]*?\/>/,
    )?.[0] || "";

    expect(liveDialog).not.toBe("");
    expect(imageDialog).not.toBe("");
    expect(liveDialog).toContain('title="删除任务组"');
    expect(liveDialog).toContain(
      'description="删除后，该任务组中的任务记录将不再显示。"',
    );
    expect(liveDialog).toContain('confirmText="删除"');
    expect(imageDialog).toContain('title="删除任务组"');
    expect(imageDialog).toContain(
      'description="删除后，该任务组中的任务记录将不再显示。"',
    );
  });

  it("keeps the live draft media and uses the custom-batch save cadence", () => {
    const source = readFileSync(
      "hooks/use-live-video-batch-workspace.ts",
      "utf8",
    );
    const createStart = source.indexOf("const createBatch =");
    const createEnd = source.indexOf("const runBatchAction", createStart);
    const createBlock = source.slice(createStart, createEnd);

    expect(source).toContain("}, 800);");
    expect(source).toContain("nextLiveVideoBatchName(batches)");
    expect(createBlock).not.toContain("media: []");
  });

  it("keeps product-library imports separate from local Live uploads", () => {
    const hook = readFileSync("hooks/use-live-video-batch-workspace.ts", "utf8");
    const workspace = readFileSync(
      "components/batch-workbench/live-video-batch-workspace.tsx",
      "utf8",
    );
    const card = readFileSync(
      "components/batch-workbench/live-video-task-card.tsx",
      "utf8",
    );

    expect(hook).toContain("importProductLibraryItem");
    expect(hook).toContain("importItemProductLibraryItem");
    expect(hook).toContain("/product-library");
    expect(hook).toContain("productLibraryItemId: drop.productLibraryItemId");
    expect(workspace).toContain("onImportProductLibraryItem");
    expect(card).toContain("onImportProductLibraryItem");
    expect(hook).not.toContain("productLibraryUrl");
  });

  it("recovers every versioned Live mutation from one stale-version conflict", () => {
    const source = readFileSync(
      "hooks/use-live-video-batch-workspace.ts",
      "utf8",
    );
    const blocks = [
      source.slice(source.indexOf("const saveDraftNow ="), source.indexOf("const markDraftDirty =")),
      source.slice(source.indexOf("const upload ="), source.indexOf("const removeMedia =")),
      source.slice(source.indexOf("const removeMedia ="), source.indexOf("const clearMedia =")),
      source.slice(source.indexOf("const patchBatch ="), source.indexOf("const updateBatchSettings =")),
      source.slice(source.indexOf("const uploadItemMedia ="), source.indexOf("const removeItemMedia =")),
      source.slice(source.indexOf("const removeItemMedia ="), source.indexOf("const retryPrompt =")),
    ];

    for (const block of blocks) {
      expect(block).toContain("retryLiveVideoVersionConflict(");
    }
  });

  it("keeps editable group names while the shared result list owns date dividers", () => {
    const source = readFileSync(
      "components/batch-workbench/live-video-batch-workspace.tsx",
      "utf8",
    );
    const unified = readFileSync(
      "components/batch-workbench/unified-batch-results.tsx",
      "utf8",
    );

    expect(source).not.toContain("formatLiveVideoBatchShanghaiDate");
    expect(unified).toContain("showDateDivider");
    expect(source).toContain('aria-label="分组名称"');
    expect(source).toContain("validateBatchGroupDownloadName");
    expect(source).toContain("controller.updateBatchName");
    expect(source).not.toContain('batch.skillSnapshot?.name || "Skill"');
  });

  it("uses only Live batch APIs without the generic tool draft", () => {
    const source = readFileSync(
      "hooks/use-live-video-batch-workspace.ts",
      "utf8",
    );
    expect(source).toContain('"/api/live-video-batches"');
    expect(source).not.toContain("tool-workspace-draft");
    expect(source).not.toContain("/api/image-batches");
    expect(source).not.toContain("/api/prompt-reverse");
  });

  it("paginates five Live groups and polls only active groups while visible", () => {
    const hook = readFileSync(
      "hooks/use-live-video-batch-workspace.ts",
      "utf8",
    );
    const route = readFileSync("app/api/live-video-batches/route.ts", "utf8");

    expect(route).toContain("LIVE_VIDEO_HISTORY_PAGE_SIZE");
    expect(route).toContain("historyOnly");
    expect(route).toContain("statusOnly");
    expect(hook).toContain("loadMoreBatches");
    expect(hook).toContain("historyOnly=1");
    expect(hook).toContain('statusOnly: "1"');
    expect(hook).toContain('document.visibilityState !== "visible"');
    expect(hook).toContain("pollInFlightRef");
    expect(hook).toContain("historyLoadInFlightRef");
  });

  it("unlocks each task prompt as soon as that task finishes Skill analysis", () => {
    const workspace = readFileSync(
      "components/batch-workbench/live-video-batch-workspace.tsx",
      "utf8",
    );
    const card = readFileSync(
      "components/batch-workbench/live-video-task-card.tsx",
      "utf8",
    );

    expect(workspace).toContain("pending={itemPending}");
    expect(workspace).not.toContain("pending={itemPending || active}");
    expect(card).toContain("const busy = pending || promptActive || videoActive;");
  });

  it("loads Live models before the authenticated workspace", () => {
    const hook = readFileSync(
      "hooks/use-live-video-batch-workspace.ts",
      "utf8",
    );

    const setModelsIndex = hook.indexOf("setModels(availableModels);");
    const loadWorkspaceIndex = hook.indexOf("const batchResponse = await apiRequest");

    expect(setModelsIndex).toBeGreaterThan(-1);
    expect(loadWorkspaceIndex).toBeGreaterThan(setModelsIndex);
    expect(hook).not.toContain("const [modelResponse, batchResponse] = await Promise.all([");
  });

  it("registers Live history into the single shared virtualized result list", () => {
    const source = readFileSync(
      "components/batch-workbench/live-video-batch-workspace.tsx",
      "utf8",
    );
    const unified = readFileSync(
      "components/batch-workbench/unified-batch-results.tsx",
      "utf8",
    );

    expect(source).not.toContain('import { Virtuoso } from "react-virtuoso";');
    expect(source).not.toContain("<Virtuoso");
    expect(source).toContain("useRegisterBatchResultSource");
    expect(source).toContain('id: "live-video-batch"');
    expect(source).toContain("loadMore: controller.loadMoreBatches");
    expect(unified).toContain("<Virtuoso");
    expect(source).not.toContain("controller.batches.map((batch, batchIndex)");
  });

  it("uses the shared scroll-to-top control instead of a Live-only one", () => {
    const source = readFileSync(
      "components/batch-workbench/live-video-batch-workspace.tsx",
      "utf8",
    );
    const unified = readFileSync(
      "components/batch-workbench/unified-batch-results.tsx",
      "utf8",
    );

    expect(source).not.toContain("ScrollToTopButton");
    expect(source).not.toContain("liveResultScrollerRef");
    expect(unified).toContain("<ScrollToTopButton");
    expect(unified).toContain("scrollContainerRef={scrollerRef}");
    expect(unified).toContain("onScrollToTop={scrollToStart}");
  });

  it("ships the Live history cursor index through the online index path", () => {
    const policy = JSON.parse(readFileSync("config/deploy/migration-policy.json", "utf8"));
    const sql = readFileSync(
      "config/deploy/online-indexes/live-video-batch-history.sql",
      "utf8",
    );
    const approval = policy.approvedOnlineIndexes.find(
      (entry: { file: string }) => entry.file === "live-video-batch-history.sql",
    );

    expect(policy.largeTables).toContain("LiveVideoBatch");
    expect(sql).toContain("CREATE INDEX CONCURRENTLY IF NOT EXISTS");
    expect(sql).toContain('ON "LiveVideoBatch" ("authUserId", "createdAt" DESC, "id" DESC)');
    expect(sql).toContain('WHERE "deletedAt" IS NULL');
    expect(approval).toMatchObject({
      table: "LiveVideoBatch",
      index: "LiveVideoBatch_active_history_idx",
    });
  });
});
