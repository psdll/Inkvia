import { existsSync } from "node:fs";
import { readChineseUiSource as readFileSync } from "./helpers/chinese-ui-source";
import { describe, expect, it } from "vitest";

const read = (path: string) => {
  expect(existsSync(path), `${path} must exist`).toBe(true);
  return readFileSync(path, "utf8").replace(/\r\n/g, "\n");
};

describe("image batch workbench UI", () => {
  it("adds an independent primary navigation entry after the toolbox", () => {
    const sidebar = read("components/layout/workspace-sidebar.tsx");
    expect(sidebar).toContain('href: "/batch-workbench"');
    expect(sidebar).toContain('label: "批量"');
    expect(sidebar.indexOf('href: "/studio"')).toBeLessThan(sidebar.indexOf('href: "/batch-workbench"'));
    expect(sidebar.indexOf('href: "/batch-workbench"')).toBeLessThan(sidebar.indexOf('href: "/works"'));
  });

  it("renders the independent page through a client interaction leaf", () => {
    const route = read("app/batch-workbench/page.tsx");
    expect(route).toContain("BatchWorkbenchPage");
    expect(route).not.toContain('"use client"');
    const page = read("components/batch-workbench/batch-workbench-page.tsx");
    expect(page.startsWith('"use client"')).toBe(true);
    expect(page).toContain("lg:grid-cols-[340px_minmax(0,1fr)]");
    expect(page).not.toContain("grid-cols-[360px_minmax(0,1fr)_300px]");
  });

  it("shows the custom batch mode to users", () => {
    const settings = read("components/batch-workbench/batch-settings-panel.tsx");
    const visibleModeOptions = settings.match(/options=\{\[([\s\S]*?)\]\}/)?.[1] || "";

    expect(visibleModeOptions).toContain(
      '{ value: "style_replication", label: "统一参考批量复刻" }',
    );
    expect(visibleModeOptions).toContain(
      '{ value: "multi_prompt", label: "自定义分批" }',
    );
  });

  it("adds the toolbox role positioning workflow after the custom batch prompt label", () => {
    const settings = read("components/batch-workbench/batch-settings-panel.tsx");
    const rolePositioning = read(
      "components/batch-workbench/batch-role-positioning.tsx",
    );
    const roleController = read(
      "hooks/use-batch-role-positioning-controller.ts",
    );
    const promptLabel = settings.search(/>\s*提示词\s*<\//);
    const roleEntry = settings.indexOf("<BatchRolePositioning", promptLabel);
    const promptEditor = settings.indexOf("<ExpandablePromptTextarea", roleEntry);

    expect(settings).toContain(
      '{batch.mode === "multi_prompt" ? (\n              <BatchRolePositioning',
    );
    expect(promptLabel).toBeGreaterThanOrEqual(0);
    expect(roleEntry).toBeGreaterThan(promptLabel);
    expect(promptEditor).toBeGreaterThan(roleEntry);
    expect(roleController).not.toContain('/api/role-positioning/status');
    expect(roleController).not.toMatch(/\bvisible\s*:/);
    expect(rolePositioning).not.toContain("controller.visible");
    expect(roleController).toContain("buildPromptWithAssetReferences(input.prompt, promptAssets)");
    expect(roleController).toContain("startBatchRolePrompt");
    expect(roleController).toContain("waitForBatchRolePromptTask");
    expect(roleController).toContain('surface: "batch_workbench"');
    expect(roleController).toContain("useAccountRolePositioningDraft");
    expect(rolePositioning).not.toContain("localStorage.setItem");
    expect(rolePositioning).toContain("showApplyResult={false}");
    expect(rolePositioning).toContain("onApplyResult={() => undefined}");
    expect(rolePositioning).not.toContain("应用到提示词");
    expect(rolePositioning).not.toContain("已应用到提示词");
    expect(rolePositioning).not.toContain("生成后可应用到提示词");
    expect(rolePositioning).toContain("controller.reversePrompt");
    expect(rolePositioning).toContain("controller.generatePrompt");
    expect(rolePositioning).toContain("生成结果会继续进入现有分段流程");
    expect(rolePositioning).toContain("<RoleSkillTrigger");
    expect(rolePositioning.match(/useAccountRolePositioningDraft/g) || []).toHaveLength(0);
    expect(roleController.match(/useAccountRolePositioningDraft/g) || []).toHaveLength(2);
  });

  it("keeps separate mode templates and shows only one upload box in custom batches", () => {
    const page = read("components/batch-workbench/batch-workbench-page.tsx");
    const settings = read("components/batch-workbench/batch-settings-panel.tsx");

    expect(page).toContain("isGroupedImageBatchMode(batch.mode)");
    expect(page).toContain("entries: historyGroups.map((group) => ({");
    expect(page).toContain("const switchBatchMode = async");
    expect(page).toContain("await loadTemplate(mode, models)");
    expect(page).toContain("imageBatchDraftSurface(mode)");
    expect(page).toContain("ephemeralInputDraftRegistry.read<ImageBatchEphemeralDraft>");
    expect(page).toContain('window.localStorage.setItem("batch_workbench_mode", mode)');
    expect(page).toContain("batchMode={group.batch.mode}");
    expect(settings).toContain("isGroupedImageBatchMode(batch.mode)");
    expect(settings).toContain("{groupedWorkflow ? (");
    expect(settings).toContain("onModeChange");
    expect(settings).toContain('dropzoneSize={batch.mode === "multi_prompt" ? "large" : "default"}');
    expect(settings).toContain('compactHeaderActions={batch.mode === "multi_prompt"}');
    expect(settings).toContain('showSummary={batch.mode === "style_replication"}');
    const referenceCondition = settings.indexOf('{batch.mode === "style_replication" ? (');
    const referenceLabel = settings.indexOf('label="参考图"', referenceCondition);
    const referenceConditionEnd = settings.indexOf(") : null}", referenceLabel);
    const productLabel = settings.indexOf('label="产品图"', referenceConditionEnd);
    expect(referenceCondition).toBeGreaterThanOrEqual(0);
    expect(referenceLabel).toBeGreaterThan(referenceCondition);
    expect(referenceConditionEnd).toBeGreaterThan(referenceLabel);
    expect(productLabel).toBeGreaterThan(referenceConditionEnd);
  });

  it("opens the existing error dialog for a new unavailable-model failure only in unified-reference mode", () => {
    const page = read("components/batch-workbench/batch-workbench-page.tsx");

    expect(page).toContain("IMAGE_MODEL_NOT_AVAILABLE");
    expect(page).toContain('group.batch.mode !== "style_replication"');
    expect(page).toContain("notifiedModelErrorOutputIdsRef");
    expect(page).toContain("setError(modelError.errorMessage");
  });

  it("removes the page header and renders persistent editable group names", () => {
    const page = read("components/batch-workbench/batch-workbench-page.tsx");
    expect(page).not.toContain("<header");
    expect(page).not.toContain("ChevronRight");
    expect(page).not.toContain("FrostedSelect");
    expect(page).toContain("changeGroupName");
    expect(page).toContain('aria-label="分组名称"');
    expect(page).toContain("group.items.map");
    expect(page).toContain("batch.groups");
  });

  it("uses the confirmed product and reference labels and no credit copy", () => {
    const files = [
      "components/batch-workbench/batch-workbench-page.tsx",
      "components/batch-workbench/batch-settings-panel.tsx",
      "components/batch-workbench/batch-task-card.tsx",
      "components/batch-workbench/batch-media-slot.tsx",
    ].map(read).join("\n");
    expect(files).toContain("产品图");
    expect(files).toContain("参考图");
    expect(files).not.toMatch(/共享产品图|风格图|积分|费用/);
  });

  it("loads and paginates five history groups independently for both image modes", () => {
    const page = read("components/batch-workbench/batch-workbench-page.tsx");

    expect(page).toContain("const HISTORY_PAGE_SIZE = 5;");
    expect(page).toContain('const IMAGE_BATCH_MODES = ["style_replication", "multi_prompt"] as const;');
    expect(page).toContain("historyPaginationByMode");
    expect(page).toContain('url.searchParams.set("take", String(HISTORY_PAGE_SIZE))');
    expect(page).toContain('url.searchParams.set("mode", mode)');
    expect(page).toContain("Promise.all(IMAGE_BATCH_MODES.map");
    expect(page).toContain("IMAGE_BATCH_MODES.forEach((mode) =>");
  });

  it("creates a fresh document-scoped template and keeps database autosave for the active document", () => {
    const page = read("components/batch-workbench/batch-workbench-page.tsx");

    expect(page).toContain('method: "POST"');
    expect(page).toContain("imageBatchDraftSurface(mode)");
    expect(page).toContain("ephemeralInputDraftRegistry.write<ImageBatchEphemeralDraft>");
    expect(page).not.toContain("const reusableTemplate = list.find");
    expect(page).not.toContain("if (isGroupedImageBatchMode(batch.mode)) return true;");
    expect(page).not.toContain("if (isGroupedImageBatchMode(batch?.mode)) return;\n    setDirty(true);");
    expect(page).toContain("window.setTimeout(() => { void saveDraft({ silent: true }); }, 800)");
    expect(page).toContain("if (!(await saveDraft())) return;");
    expect(page).not.toContain("readBatchTemplateBackup");
    expect(page).not.toContain("batch_workbench_template_v2_");
  });

  it("discards stale template responses after an account change", () => {
    const page = read("components/batch-workbench/batch-workbench-page.tsx");

    expect(page).toContain("templateRequestEpochRef");
    expect(page).toContain("currentAccountIdRef");
    expect(page).toContain("applyLoadedTemplate");
    expect(page).toContain("templateDraftWritable");
    expect(page).toContain("historyLoadRequestRef");
    expect(page).toContain("historyStatusRequestRef");
    expect(page).toContain("historyGroupsRef.current = []");
    expect(page).toContain("setHistoryGroups([])");
    expect(page).toMatch(/const loadBatch[\s\S]{0,500}templateRequestEpochRef\.current !== requestEpoch/);
    expect(page).toMatch(/const loadHistoryPage[\s\S]{0,1400}historyLoadRequestRef\.current\[mode\] !== requestId/);
    expect(page).toMatch(/const refreshActiveHistoryStatuses[\s\S]{0,1000}historyStatusRequestRef\.current !== requestId/);
    expect(page).toMatch(/const saveDraft[\s\S]{0,700}currentSave\.accountId === accountId/);
    expect(page).toContain("if (!requestIsCurrent()) return false");
    expect(page).toContain("current?.id === batchId");
    expect(page).toContain("draftSaveInFlight.current = null");
    expect(page).toMatch(/if \(cancelled \|\| currentAccountIdRef\.current !== accountId/);
  });

  it("reconciles remembered drafts with the server and recovers version conflicts", () => {
    const page = read("components/batch-workbench/batch-workbench-page.tsx");

    expect(page).toContain("class BatchApiError extends Error");
    expect(page).toContain("remembered?.batch.version === serverBatch.version");
    expect(page).toContain("dirtyItemIds.current = new Set(loaded.dirtyItemIds)");
    expect(page).toContain("dirtyGroupIds.current = new Set(loaded.dirtyGroupIds)");
    expect(page).toContain('saveError.code === "BATCH_VERSION_CONFLICT"');
    expect(page).toContain("await loadBatch(batchId)");
  });

  it("shows the grouped product-image count in the group summary", () => {
    const page = read("components/batch-workbench/batch-workbench-page.tsx");

    expect(page).toContain(
      'const imageRole = batchMode === "multi_prompt" ? "product" : "reference";',
    );
    expect(page).toContain(
      'const imageLabel = batchMode === "multi_prompt" ? "产品图" : "参考图";',
    );
    expect(page).toContain(
      "const imageCount = items[0]?.media.filter((entry) => entry.role === imageRole).length || 0;",
    );
    expect(page).toContain(": <>{imageCount} 张{imageLabel}</>}</span>");
    expect(page).toContain("batchMode={group.batch.mode}");
  });

  it("lets the prompt editor fill the remaining settings-panel height", () => {
    const settings = read("components/batch-workbench/batch-settings-panel.tsx");

    expect(settings).toContain(
      'className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4 pb-0"',
    );
    expect(settings).toContain('className="mt-5 flex min-h-0 flex-1 flex-col"');
    expect(settings).toContain(
      'className="shrink-0 space-y-3 bg-[var(--panel-bg)] px-4 pb-4 pt-2"',
    );
  });

  it("uses the unified compact task-card presentation for both grouped modes", () => {
    const card = read("components/batch-workbench/batch-task-card.tsx");
    const gallery = read("components/batch-workbench/batch-media-gallery.tsx");
    const result = read("components/batch-workbench/batch-task-result.tsx");
    const page = read("components/batch-workbench/batch-workbench-page.tsx");

    expect(card).toContain("flex flex-col rounded-lg");
    expect(card).toContain("order-2 flex aspect-[3/4]");
    expect(card).toContain("relative order-3 border-b");
    expect(card).toContain("order-4 grid max-h-32 grid-cols-2");
    expect(card).toContain('"order-4 p-3"');
    expect(card).toContain('{batchMode === "style_replication" ? (');
    expect(card).toContain(
      'showCompactHeader={batchMode !== "multi_prompt"}',
    );
    expect(card).toContain(
      'showCompactIndex={batchMode !== "multi_prompt"}',
    );
    expect(card).toContain("compact");
    expect(card).not.toContain("BatchStatusBadge");
    expect(card).not.toContain("task-params-region");
    expect(card).not.toContain("附加统一提示词");
    expect(card).not.toContain("FrostedSelect");
    expect(gallery).toContain("showCompactHeader = true");
    expect(gallery).toContain("showCompactIndex = true");
    expect(gallery).toContain("compact && !showCompactHeader ? null : (");
    expect(gallery).toContain("!compact || showCompactIndex ? (");
    expect(page).not.toContain("onDuplicate={() => addTask(item)}");
    expect(page).not.toContain("onDelete={() => deleteTask(item.id)}");
    expect(page).not.toContain("const deleteTask = async");
    expect(result).toContain("compact: boolean;");
    expect(result).not.toContain('batchMode === "style_replication"');
  });

  it("keeps unified-reference prompt edits local so delayed history updates do not move the caret", () => {
    const card = read("components/batch-workbench/batch-task-card.tsx");

    expect(card).toContain(
      'const preservePromptSelection = batchMode === "style_replication";',
    );
    expect(card).toContain(
      "const [promptDraft, setPromptDraft] = React.useState(item.prompt);",
    );
    expect(card).toContain("if (!promptEditorOpen) setPromptDraft(item.prompt);");
    expect(card).toContain(
      "value={preservePromptSelection ? promptDraft : item.prompt}",
    );
    expect(card).toContain("const nextPrompt = event.target.value;");
    expect(card).toContain(
      "if (preservePromptSelection) setPromptDraft(nextPrompt);",
    );
    expect(card).toContain("onChange({ prompt: nextPrompt });");
  });

  it("uses one generated result per task without a result count control", () => {
    const page = read("components/batch-workbench/batch-workbench-page.tsx");
    const card = read("components/batch-workbench/batch-task-card.tsx");

    expect(card).not.toContain("结果数量");
    expect(card).not.toContain("COUNT_OPTIONS");
    expect(card).not.toContain("item.outputCount");
    expect(page).not.toContain("outputCount: item.outputCount");
    expect(page).toContain("const totalOutputs = batch.items.length");
  });

  it("removes the batch overview area without reserving a third column", () => {
    const page = read("components/batch-workbench/batch-workbench-page.tsx");
    expect(page).not.toContain("BatchSummaryPanel");
    expect(page).not.toContain("批次概览");
    expect(existsSync("components/batch-workbench/batch-summary-panel.tsx")).toBe(false);
  });

  it("shows persisted running and terminal elapsed seconds", () => {
    const badge = read("components/batch-workbench/batch-status-badge.tsx");
    expect(badge).toContain("已运行");
    expect(badge).toContain("耗时");
    expect(badge).toContain("elapsedSeconds");
  });

  it("provides loading, empty and modal error states", () => {
    const page = read("components/batch-workbench/batch-workbench-page.tsx");
    const dialog = read("components/ui/confirm-dialog.tsx");

    expect(page).toContain("BatchWorkbenchSkeleton");
    expect(read("components/batch-workbench/unified-batch-results.tsx")).toContain("还没有批量任务");
    expect(page).toContain("<ConfirmDialog");
    expect(page).toContain("open={Boolean(error)}");
    expect(page).toContain('title="操作失败"');
    expect(page).toContain("showCancel={false}");
    expect(dialog).toContain("showCancel");
  });

  it("keeps the workbench visible for guests and requests login before uploads", () => {
    const page = read("components/batch-workbench/batch-workbench-page.tsx");
    const gallery = read("components/batch-workbench/batch-media-gallery.tsx");

    expect(page).toContain("createAnonymousBatch");
    expect(page).toContain("if (!user)");
    expect(page).toContain("authLoading");
    expect(gallery).toContain("useAuth");
    expect(gallery).toContain("requestFileSelection");
    expect(gallery).toContain("openLoginModal");
  });

  it("uses product snapshots as the style replication grouping workflow", () => {
    const page = read("components/batch-workbench/batch-workbench-page.tsx");
    const settings = read("components/batch-workbench/batch-settings-panel.tsx");
    const card = read("components/batch-workbench/batch-task-card.tsx");
    const gallery = read("components/batch-workbench/batch-media-gallery.tsx");

    expect(page).toContain("/api/image-batches/${batch.id}/groups");
    expect(page).not.toContain("createItemPerFile");
    expect(page).toContain("isGroupedImageBatchMode(batch.mode)");
    expect(settings).toContain("生成分组");
    expect(settings).toContain("BatchMediaGallery");
    expect(settings).toContain('entry.role === "product"');
    expect(card).toContain('entry.role === "reference"');
    expect(card).toContain("BatchMediaGallery");
    expect(card).toContain("allowMultipleProductMedia: boolean");
    expect(card).toContain("multiple={allowMultipleProductMedia}");
    expect(card).toContain("allowMultipleProductMedia ? files : files.slice(0, 1)");
    expect(page).toContain(
      'allowMultipleProductMedia={group.batch.mode === "multi_prompt"}',
    );
    expect(gallery).toContain("relations.map");
  });

  it("keeps product-library imports separate from local image uploads", () => {
    const page = read("components/batch-workbench/batch-workbench-page.tsx");
    const settings = read("components/batch-workbench/batch-settings-panel.tsx");
    const card = read("components/batch-workbench/batch-task-card.tsx");

    expect(settings).toContain("onImportProductLibraryItem");
    expect(card).toContain("onImportProductLibraryItem");
    expect(page).toContain("importProductLibraryItem");
    expect(page).toContain("/api/image-batches/${uploadBatchId}/product-library");
    expect(page).toContain("/api/image-batches/${uploadBatchId}/media");
    expect(page).toContain("productLibraryItemId: drop.productLibraryItemId");
    expect(page).not.toContain("productLibraryUrl");
  });

  it("shows a visible limit message instead of silently truncating product uploads", () => {
    const page = read("components/batch-workbench/batch-workbench-page.tsx");
    const settings = read("components/batch-workbench/batch-settings-panel.tsx");
    const gallery = read("components/batch-workbench/batch-media-gallery.tsx");

    expect(gallery).toContain("onLimitExceeded");
    expect(gallery).toContain("本次最多还可添加");
    expect(gallery).not.toContain("images.slice(0, remaining)");
    expect(settings).toContain("onLimitExceeded={onLimitExceeded}");
    expect(page).toContain("onLimitExceeded={setError}");
  });

  it("shows an explicit over-limit message while prompt splitting is blocked", () => {
    const dialog = read("components/batch-workbench/prompt-split-dialog.tsx");

    expect(dialog).toContain("IMAGE_BATCH_LIMITS.maxItems");
    expect(dialog).toContain("已超过上限");
  });

  it("keeps the generate-group action only in the settings panel", () => {
    const page = read("components/batch-workbench/batch-workbench-page.tsx");
    const settings = read("components/batch-workbench/batch-settings-panel.tsx");
    const segmentedFlow = page.match(
      /const generateSegmentedPrompts = async[\s\S]*?const applySplitPrompts/,
    )?.[0] || "";

    expect(settings).toContain("onClick={() => void onGenerateGroups()}");
    expect(settings).toContain('batch.mode === "multi_prompt"');
    expect(settings).toContain("生成分段提示词");
    expect(settings).toContain("生成分段提示词中");
    expect(settings).toContain("生成分组");
    expect(settings).toContain("onGenerateSegmentedPrompts");
    expect(page).toContain("const generateSegmentedPrompts = async");
    expect(page).toContain("segmentedRunLockRef.current");
    expect(page).toContain("kind=segmented_prompts");
    expect(page).toContain("generatedPrompt");
    expect(segmentedFlow).toContain("mediaSnapshots");
    expect(segmentedFlow).not.toContain("mediaRelationIds");
    expect(segmentedFlow).not.toContain("expectedVersion");
    expect(segmentedFlow).not.toContain("templateVersion");
    expect(segmentedFlow).not.toContain("!batch.sharedPrompt.trim()");
    expect(page).toContain('url.searchParams.set("mode", mode)');
    expect(page).toContain("loadHistoryPage(null, { mode, quiet: true })");
    expect(page).toContain("batchMode={group.batch.mode}");
    expect(page).toContain('if (batch.mode !== "style_replication") return;');
    expect(page).not.toMatch(/onApply=\{\(content\).*sharedPrompt/);
    expect(page).not.toContain("onClick={() => void generateGroups()}");
  });

  it("keeps custom-batch inputs editable while one segmented run is pending", () => {
    const page = read("components/batch-workbench/batch-workbench-page.tsx");
    const settings = read("components/batch-workbench/batch-settings-panel.tsx");
    const rolePositioning = read(
      "components/batch-workbench/batch-role-positioning.tsx",
    );
    const settingsCall = page.match(/<BatchSettingsPanel[\s\S]*?\/>/)?.[0] || "";
    const settingsDisabled = settingsCall.match(
      /disabled=\{([\s\S]*?)\}\s+switchingMode=/,
    )?.[1] || "";
    const systemPromptInput = rolePositioning.match(
      /value=\{controller\.systemPrompt\}[\s\S]*?\/>/,
    )?.[0] || "";
    const generatedResultInput = rolePositioning.match(
      /value=\{controller\.reversePrompt\}[\s\S]*?\/>/,
    )?.[0] || "";

    expect(settingsDisabled).not.toContain("segmentedPromptPending");
    expect(settings).toContain(
      "disabled={disabled || switchingMode || segmentedPromptPending}",
    );
    expect(page).toMatch(
      /const switchBatchMode = async[\s\S]*?\|\| segmentedPromptPending[\s\S]*?\) return;/,
    );
    expect(page).toContain("removingSharedMediaIds");
    expect(page).toContain("mediaMutationPending");
    expect(settings).toContain("mediaMutationPending");
    expect(systemPromptInput).not.toContain("disabled={controller.busy}");
    expect(generatedResultInput).toContain("disabled={controller.busy}");
  });

  it("opens the login modal instead of showing an inline error for guest generation", () => {
    const page = read("components/batch-workbench/batch-workbench-page.tsx");

    expect(page).toContain("loading: authLoading, openLoginModal");
    expect(page).toMatch(
      /const generateGroups = async \(\) => \{[\s\S]*?if \(!user\) \{[\s\S]*?openLoginModal\(\);[\s\S]*?return;/,
    );
  });

  it("keeps pending task actions scoped independently from group actions", () => {
    const page = read("components/batch-workbench/batch-workbench-page.tsx");
    const itemActionBlock = page.match(
      /const runItemAction = async[\s\S]*?const errorDialog =/,
    )?.[0] || "";

    expect(page).toContain("creatingGroup");
    expect(page).toContain("submittingBatchIds");
    expect(page).toContain("deletingGroupIds");
    expect(page).toContain("pendingItemActions");
    expect(page).toContain("resolveFailedTaskAction");
    expect(page).toContain("/retry");
    expect(page).not.toContain("disabled={uploading || busy || active}");
    expect(page).not.toContain("busy={uploading || busy || groupActive}");
    expect(page).not.toContain("FrostedSelect");
    expect(itemActionBlock).not.toContain("setSubmittingBatchIds");
  });

  it("allows editing and saving a group name while its tasks are active", () => {
    const page = read("components/batch-workbench/batch-workbench-page.tsx");
    const renameBlock = page.match(
      /const changeHistoryGroupName[\s\S]*?const mutate/,
    )?.[0] || "";

    expect(renameBlock).not.toBe("");
    expect(page).not.toContain(
      "if (!group || isBatchActive(group.batch.status)) continue;",
    );
    expect(page).toContain('aria-label="编辑分组名称"');
    expect(page).toContain("setEditingGroupId(group.id)");
    expect(page).toContain("const settingsEntry = groupActive");
    expect(page).toContain("!isBatchItemActive(item)");
    expect(renameBlock).not.toContain("isBatchActive");
  });

  it("unlocks each completed task prompt while sibling tasks remain active", () => {
    const page = read("components/batch-workbench/batch-workbench-page.tsx");
    const changeItemBlock = page.match(
      /const changeHistoryItem = \([\s\S]*?const changeHistoryGroupSettings/,
    )?.[0] || "";
    const flushBlock = page.match(
      /const flushHistoryChanges = React\.useCallback\([\s\S]*?const scheduleHistorySave/,
    )?.[0] || "";

    expect(page).toContain("function isBatchItemActive(item: BatchItem)");
    expect(page).toContain("isActiveBatchOutputStatus(output.status)");
    expect(page).toMatch(
      /promptBusy=\{itemActive[\s\S]*?groupSubmitting[\s\S]*?groupDeleting[\s\S]*?pendingAction !== null\}/,
    );
    expect(changeItemBlock).toContain("if (isBatchItemActive(item)) return;");
    expect(changeItemBlock).not.toContain("if (isBatchActive(group.batch.status)) return;");
    expect(flushBlock).toContain("!isBatchItemActive(item)");
  });

  it("keeps optimistic creating-group prompts locked before durable tasks exist", () => {
    const page = read("components/batch-workbench/batch-workbench-page.tsx");
    const changeItemBlock = page.match(
      /const changeHistoryItem = \([\s\S]*?const changeHistoryGroupSettings/,
    )?.[0] || "";
    const flushBlock = page.match(
      /const flushHistoryChanges = React\.useCallback\([\s\S]*?const scheduleHistorySave/,
    )?.[0] || "";

    expect(changeItemBlock).toContain('if (group.batch.status === "creating") return;');
    expect(flushBlock).toContain('if (group.batch.status === "creating") return false;');
    expect(page).toContain('group.batch.status === "creating"');
  });

  it("keeps the latest server version after history media changes", () => {
    const page = read("components/batch-workbench/batch-workbench-page.tsx");

    expect(page).toContain("syncHistoryBatchVersion");
    expect(page).toContain("Math.max(group.batch.version, version)");
    expect(page).toContain(
      "ApiEnvelope & { relations: BatchMediaRelation[]; version: number }",
    );
    expect(page).toContain(
      "ApiEnvelope & { version: number }",
    );
  });

  it("shows every failed upload filename and reason in a multiline dialog", () => {
    const page = read("components/batch-workbench/batch-workbench-page.tsx");

    expect(page).toContain("chunk.map((file) => `${file.name}：${message}`).join(\"\\n\")");
    expect(page).toContain("whitespace-pre-line");
  });

  it("sends image uploads in bounded multi-file requests", () => {
    const page = read("components/batch-workbench/batch-workbench-page.tsx");

    expect(page).toContain("chunkBatchUploadFiles(files)");
    expect(page).toContain('form.append("file", file)');
    expect(page).not.toContain("await mapWithConcurrency(\n        files");
  });

  it("keeps space between a group divider and the following group header", () => {
    const unified = read("components/batch-workbench/unified-batch-results.tsx");

    expect(unified).toContain("border-b border-[var(--border)] pb-6 pt-6");
  });

  it("uses optimistic local mutations and virtualizes large history", () => {
    const page = read("components/batch-workbench/batch-workbench-page.tsx");

    expect(page).toContain("createLocalMediaRelation");
    expect(page).toContain("chunkBatchUploadFiles");
    expect(page).toContain("replaceHistoryMediaRelation");
    expect(page).toContain("rollbackHistoryMediaRelation");
    expect(page).not.toContain("<Virtuoso");
    expect(page).toContain('id: "image-batch"');
    expect(read("components/batch-workbench/unified-batch-results.tsx")).toContain("computeItemKey");
    expect(page).not.toContain("await refreshHistoryBatch(submitBatchId)");
  });

  it("adds the shared scroll-to-top control to both image batch modes", () => {
    const page = read("components/batch-workbench/batch-workbench-page.tsx");
    const unified = read("components/batch-workbench/unified-batch-results.tsx");

    expect(page).not.toContain("ScrollToTopButton");
    expect(page).not.toContain("imageBatchResultScrollerRef");
    expect(unified).toContain("<ScrollToTopButton");
    expect(unified).toContain("scrollContainerRef={scrollerRef}");
    expect(unified).toContain("onScrollToTop={scrollToStart}");
  });

  it("clears all shared media without a confirmation dialog", () => {
    const page = read("components/batch-workbench/batch-workbench-page.tsx");
    const gallery = read("components/batch-workbench/batch-media-gallery.tsx");

    expect(page).toContain("clearSharedMedia");
    expect(page).not.toContain("window.confirm");
    expect(gallery).toContain("onClick={() => void onClear()}");
    expect(gallery).toContain("onClick={() => void onRemove(relation)}");
  });

  it("requires confirmation before deleting an image-mode task group", () => {
    const page = read("components/batch-workbench/batch-workbench-page.tsx");

    expect(page).toMatch(
      /const \[pendingDeleteGroup, setPendingDeleteGroup\]\s*=\s*React\.useState<BatchHistoryGroup \| null>\(null\);/,
    );
    expect(page).toContain(
      "onClick={() => setPendingDeleteGroup(group)}",
    );
    expect(page).toContain("open={Boolean(pendingDeleteGroup)}");
    expect(page).toContain('title="删除任务组"');
    expect(page).toContain("await deleteGroup(pendingDeleteGroup);");
  });

  it("shows a group zip download only when the latest results include successes", () => {
    const page = read("components/batch-workbench/batch-workbench-page.tsx");

    expect(page).toContain("selectLatestSuccessfulBatchOutputs(group.items)");
    expect(page).toContain("下载整组");
    expect(page).toContain("downloadHistoryGroup(group)");
    expect(page).toContain("groupId=${encodeURIComponent(group.id)}");
    expect(page.indexOf("删除分组")).toBeLessThan(page.indexOf("下载整组"));
  });

  it("blocks unsafe group names and saves a valid name before downloading", () => {
    const page = read("components/batch-workbench/batch-workbench-page.tsx");

    expect(page).toContain("validateBatchGroupDownloadName");
    expect(page).toContain("groupNameErrors");
    expect(page).toContain('aria-invalid={Boolean(groupNameErrors[group.id])}');
    expect(page).toContain('role="alert"');
    expect(page).toMatch(
      /const downloadHistoryGroup[\s\S]*?await flushHistoryChanges\(group\.batchId\)[\s\S]*?groupId=\$\{encodeURIComponent\(group\.id\)\}/,
    );
    expect(page).not.toContain("fallbackName");
    expect(page).not.toContain("maxLength={120}");
  });

  it("edits and saves group settings in both batch modes before submitting", () => {
    const page = read("components/batch-workbench/batch-workbench-page.tsx");

    expect(page).toContain("dirtyHistorySettings");
    expect(page).toContain("changeHistoryGroupSettings");
    expect(page).toContain("applyHistoryGroupSettingsPatch");
    expect(page).toContain('variant="groupHeader"');
    expect(page).toMatch(/batchMode=\{group\.batch\.mode\}[\s\S]{0,100}editable/);
    expect(page).not.toMatch(
      /editable=\{Boolean\(\s*historyGroup\?\.batch\.mode === "multi_prompt",?\s*\)\}/,
    );
    expect(page).toContain(
      "batch: settingsEntry ? { sharedSettings: settingsEntry.settings } : undefined",
    );
    expect(page).toContain("overrides: updatedItem.overrides");
    expect(page.match(/const dirtySettings =/g) || []).toHaveLength(2);
    expect(page).toMatch(
      /if \(targetBatchId\)[\s\S]*?await flushHistoryChanges\(submitBatchId\)[\s\S]*?await submitBatchItems\(submitBatchId, itemIds\)/,
    );
  });
});
