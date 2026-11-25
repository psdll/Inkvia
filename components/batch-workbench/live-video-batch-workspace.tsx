"use client";
import { useUiLocale } from "@/i18n/ui";

import { UiProps, UiText } from "@/i18n/ui";


import * as React from "react";
import { BatchWorkbenchSkeleton } from "@/components/batch-workbench/batch-workbench-loading";
import {
  Download,
  Pencil,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { useAuth } from "@/components/auth/AuthProvider";
import { BatchMediaGallery } from "@/components/batch-workbench/batch-media-gallery";
import { GenerateActionButton } from "@/components/batch-workbench/generate-action-button";
import { LiveVideoTaskCard } from "@/components/batch-workbench/live-video-task-card";
import { LiveVideoParameterDock } from "@/components/batch-workbench/live-video-parameter-dock";
import {
  useRegisterBatchResultSource,
  type BatchResultSource,
} from "@/components/batch-workbench/batch-result-registry";
import {
  buildBatchPromptAssets,
  type BatchMediaRelation,
} from "@/components/batch-workbench/types";
import { RoleSkillDialog } from "@/components/role-skills/role-skill-dialog";
import { RoleSkillTrigger } from "@/components/role-skills/role-skill-trigger";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ExpandablePromptTextarea } from "@/components/ui/expandable-prompt-textarea";
import { FrostedSelect } from "@/components/ui/frosted-select";
import { AtomicPageReveal } from "@/components/layout/atomic-page-reveal";
import { useRoleSkillCatalog } from "@/hooks/use-role-skill-catalog";
import {
  type LiveVideoBatchItem,
  useLiveVideoBatchWorkspace,
} from "@/hooks/use-live-video-batch-workspace";
import { LIVE_VIDEO_BATCH_MAX_MEDIA } from "@/lib/live-video-batch/contracts";
import { validateBatchGroupDownloadName } from "@/lib/image-batch/group-download-name";

type WorkbenchMode = "style_replication" | "multi_prompt" | "live_video";
const ACTIVE_VIDEO_STATUSES = new Set(["queued", "submitting", "waiting_provider"]);

function mediaRelations(batchMedia: ReturnType<typeof useLiveVideoBatchWorkspace>["draft"]): BatchMediaRelation[] {
  return (batchMedia?.items || []).flatMap((entry) => entry.sourceMedia ? [{
    id: entry.id,
    itemId: null,
    role: "product",
    position: entry.position,
    media: {
      id: entry.sourceMedia.id,
      originalName: entry.sourceMedia.originalName,
      originalKey: entry.sourceMedia.originalKey,
      publicUrl: entry.sourceMedia.publicUrl,
    },
  }] : []);
}

function latestOutput(item: LiveVideoBatchItem) {
  return [...(item.outputs || [])].sort((left, right) => right.attempt - left.attempt)[0] || null;
}

function latestSuccessfulOutput(item: LiveVideoBatchItem) {
  return [...(item.outputs || [])]
    .filter((output) => output.status === "success" && output.generation?.localPath?.toLowerCase().endsWith(".mp4"))
    .sort((left, right) => right.attempt - left.attempt)[0] || null;
}

function LiveBatchResultSourceRegistration({ source }: { source: BatchResultSource }) {
  useRegisterBatchResultSource(source);
  return null;
}

export function LiveVideoBatchWorkspace({
  onModeChange,
  onInitialReady,
}: {
  onModeChange(mode: Exclude<WorkbenchMode, "live_video">): void;
  onInitialReady?: () => void;
}) {
  const { text, error: uiError, label: uiLabel } = useUiLocale();
  const { user, loading: authLoading, openLoginModal } = useAuth();
  const accountId = user?.id ? String(user.id) : "";
  const controller = useLiveVideoBatchWorkspace({ accountId });
  const {
    skills,
    loading: skillsLoading,
    error: skillsError,
  } = useRoleSkillCatalog({ authUserId: accountId, enabled: Boolean(accountId) });
  const [skillDialogOpen, setSkillDialogOpen] = React.useState(false);
  const [deleteBatchId, setDeleteBatchId] = React.useState("");
  const [editingBatchId, setEditingBatchId] = React.useState("");
  const [editingBatchName, setEditingBatchName] = React.useState("");
  const groupNameComposingRef = React.useRef(false);
  const [groupNameErrors, setGroupNameErrors] = React.useState<Record<string, string>>({});
  const selectedSkill = skills.find((skill) => skill.id === controller.selectedSkillId) || null;
  const relations = [
    ...mediaRelations(controller.draft),
    ...controller.pendingMedia,
  ].sort((left, right) => left.position - right.position);
  const promptAssets = buildBatchPromptAssets(relations);

  if (controller.loading || authLoading) {
    return (
      <AtomicPageReveal ready={!authLoading && !controller.loading} onReveal={onInitialReady}>
      <div className="h-full min-h-0 w-full flex-1 overflow-hidden">
        <BatchWorkbenchSkeleton />
      </div>
      </AtomicPageReveal>
    );
  }

  const createDisabled = !accountId
    || controller.creating
    || controller.uploading
    || !relations.length
    || !controller.selectedSkillId
    || !controller.settings.model;

  const commitBatchName = async (batch: (typeof controller.batches)[number], name: string) => {
    const nextName = name.trim();
    const validationError = validateBatchGroupDownloadName(nextName);
    if (validationError) {
      setGroupNameErrors((current) => ({ ...current, [batch.id]: validationError }));
      return;
    }
    if (nextName === batch.name) {
      setEditingBatchId("");
      return;
    }
    if (await controller.updateBatchName(batch, nextName)) {
      setEditingBatchId("");
      setGroupNameErrors((current) => ({ ...current, [batch.id]: "" }));
    }
  };

  const renderLiveBatch = (batch: (typeof controller.batches)[number]) => {
    const active = batch.items.some((item) => {
      const output = latestOutput(item);
      return item.promptStatus === "prompt_queued"
        || item.promptStatus === "prompt_running"
        || Boolean(output && ACTIVE_VIDEO_STATUSES.has(output.status));
    });
    const allPromptsReady = batch.items.every((item) => Boolean(item.prompt.trim())
      && item.promptStatus !== "prompt_queued"
      && item.promptStatus !== "prompt_running");
    const allItemsHaveMedia = batch.items.every((item) => Boolean(item.sourceMedia));
    const downloadable = batch.items.filter((item) => Boolean(latestSuccessfulOutput(item))).length;
    const groupPending = controller.pendingActions.has(`submit:${batch.id}`)
      || controller.pendingActions.has(`delete:${batch.id}`)
      || controller.pendingActions.has(`settings:${batch.id}`)
      || controller.pendingActions.has(`name:${batch.id}`);
    const groupModelLabel = controller.models.find((model) => model.id === batch.videoSettings.model)?.label
      || (batch.videoSettings.model ? text("workspaceFollowup.mda3c032728f5") : text("workspaceFollowup.m9bb63745df8f"));
    const groupRatioLabel = batch.videoSettings.ratio === "adaptive"
      ? text("workspaceFollowup.m7eb336e42cb5")
      : batch.videoSettings.ratio;

    return (
      <div>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 px-1">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            {editingBatchId === batch.id ? (
              <div className="min-w-0">
                <UiProps ids={{"aria-label":["batch.md7e266bdc806"]}}><input
                  aria-label="batch.md7e266bdc806"
                  aria-invalid={Boolean(groupNameErrors[batch.id])}
                  aria-describedby={groupNameErrors[batch.id]
                    ? `live-group-name-error-${batch.id}`
                    : undefined}
                  // Registry publication runs in an effect; let the DOM retain the IME draft.
                  defaultValue={batch.name}
                  size={Math.max(1, Array.from(editingBatchName).length)}
                  disabled={groupPending}
                  autoFocus
                  onChange={(event) => {
                    setEditingBatchName(event.target.value);
                    setGroupNameErrors((current) => ({ ...current, [batch.id]: "" }));
                  }}
                  onCompositionStart={() => { groupNameComposingRef.current = true; }}
                  onCompositionEnd={() => { groupNameComposingRef.current = false; }}
                  onBlur={(event) => void commitBatchName(batch, event.currentTarget.value)}
                  onKeyDown={(event) => {
                    if (groupNameComposingRef.current || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
                    if (event.key === "Enter") {
                      event.preventDefault();
                      event.currentTarget.blur();
                    }
                    if (event.key === "Escape") {
                      setEditingBatchId("");
                      setEditingBatchName(batch.name);
                    }
                  }}
                  className="h-9 min-w-[10rem] max-w-[min(24rem,60vw)] rounded-xl border border-[var(--primary-bg)] bg-[var(--input-bg)] px-3 text-sm font-semibold text-[var(--app-fg)] outline-none [field-sizing:content] disabled:opacity-60"
                /></UiProps>
                {groupNameErrors[batch.id] ? (
                  <p
                    id={`live-group-name-error-${batch.id}`}
                    role="alert"
                    className="mt-1 px-1 text-xs text-red-500"
                  >
                    {uiError(groupNameErrors[batch.id])}
                  </p>
                ) : null}
              </div>
            ) : (
              <div className="inline-flex h-9 max-w-full items-center gap-1 px-3">
                <span className="max-w-[min(24rem,60vw)] truncate text-sm font-semibold text-[var(--app-fg)]">
                  {batch.name}
                </span>
                <UiProps ids={{"aria-label":["batch.m9064f48f29b1"],"title":["batch.m9064f48f29b1"]}}><button
                  type="button"
                  aria-label="batch.m9064f48f29b1"
                  title="batch.m9064f48f29b1"
                  disabled={groupPending}
                  onClick={() => {
                    setEditingBatchId(batch.id);
                    setEditingBatchName(batch.name);
                    setGroupNameErrors((current) => ({ ...current, [batch.id]: "" }));
                  }}
                  className="-mr-1 rounded-md p-1 text-[var(--app-muted)] transition-colors hover:bg-[var(--panel-2)] hover:text-[var(--app-fg)] disabled:opacity-45"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button></UiProps>
              </div>
            )}
            <UiProps ids={{"aria-label":["batch.m457835edc19c"]}}><div
              aria-label="batch.m457835edc19c"
              className="flex h-9 flex-wrap items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--panel-bg)] px-3 text-[10px] text-[var(--app-muted)]"
            >
              <span>{batch.items.length}<UiText id="batch.m9d1c7d26f0a6" /></span>
              <span className="h-3 w-px bg-[var(--border)]" />
              <span className="max-w-36 truncate text-[var(--app-fg)]">{uiLabel(groupModelLabel)}</span>
              <span>{uiLabel(groupRatioLabel)}</span>
              <span>{batch.videoSettings.resolution}</span>
              <span>{batch.videoSettings.duration}<UiText id="batch.m00fe8dda1fd7" /></span>
              <span>{batch.videoSettings.generateAudio ? <UiText id="batch.m3d85e020e1e3" /> : <UiText id="batch.mf9e2ebfa3cbb" />}</span>
            </div></UiProps>
            <LiveVideoParameterDock
              variant="groupHeader"
              settings={batch.videoSettings}
              models={controller.models}
              disabled={active || groupPending}
              onChange={(value) => void controller.updateBatchSettings(batch, value)}
            />
          </div>
          <div className="flex items-center gap-2">
            <GenerateActionButton
              busy={controller.pendingActions.has(`submit:${batch.id}`)}
              disabled={active || groupPending || !allPromptsReady || !allItemsHaveMedia}
              onClick={() => void controller.submitBatch(batch)}
              className="h-9 px-3"
            ><UiText id="batch.m92eb1b5951f4" /></GenerateActionButton>
            <button
              type="button"
              disabled={active || groupPending}
              onClick={() => setDeleteBatchId(batch.id)}
              className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-[var(--border)] bg-[var(--panel-bg)] px-3 text-xs text-[var(--app-muted)] hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-500 disabled:opacity-45"
            >
              <Trash2 className="h-3.5 w-3.5" /><UiText id="batch.m7605c1d82eed" /></button>
            {downloadable ? (
              <a
                href={`/api/live-video-batches/${batch.id}/download`}
                className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-[var(--border)] bg-[var(--panel-bg)] px-3 text-xs text-[var(--app-fg)] hover:border-[var(--primary-bg)] hover:text-[var(--primary-bg)]"
              >
                <Download className="h-3.5 w-3.5" /><UiText id="batch.m2919488bdcbd" /></a>
            ) : null}
          </div>
        </div>

        <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
          {batch.items.map((item) => {
            const itemPending = Array.from(controller.pendingActions).some((key) => key.endsWith(item.id));
            return (
              <LiveVideoTaskCard
                key={item.id}
                batch={batch}
                item={item}
                pending={itemPending}
                onPromptCommit={(prompt) => void controller.updatePrompt(batch, item.id, prompt)}
                onMediaUpload={(files) => void controller.uploadItemMedia(batch, item.id, files)}
                onImportProductLibraryItem={(drop) => void controller.importItemProductLibraryItem(
                  batch,
                  item.id,
                  drop,
                )}
                onMediaRemove={() => void controller.removeItemMedia(batch, item.id)}
                onPromptRetry={() => void controller.retryPrompt(batch.id, item.id)}
                onVideoRetry={() => void controller.retryVideo(batch.id, item.id)}
              />
            );
          })}
        </div>
      </div>
    );
  };
  const liveResultSource: BatchResultSource = {
    id: "live-video-batch",
    entries: controller.batches.map((batch) => ({
      key: `live-video:${batch.id}`,
      mode: "live_video",
      modeLabel: text("workspaceFollowup.md3bf132f8ba4"),
      mediaKind: "video",
      createdAt: batch.createdAt,
      content: renderLiveBatch(batch),
    })),
    hasMore: controller.hasMoreHistory,
    loadingMore: controller.loadingMoreHistory,
    loadMore: controller.loadMoreBatches,
  };

  return (
    <AtomicPageReveal ready={!authLoading && !controller.loading} onReveal={onInitialReady}>
    <div className="relative flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden">
      <LiveBatchResultSourceRegistration source={liveResultSource} />
      <div className="h-full min-h-0 w-full [&>aside]:h-full">
        <aside className="flex min-h-0 flex-col overflow-hidden rounded-[24px] border border-[var(--border)] bg-[var(--panel-bg)] shadow-[var(--shadow-2)]">
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
            <div>
              <span className="mb-3 block text-[13px] font-semibold leading-5 text-[var(--app-fg)]"><UiText id="batch.md550103a12fa" /></span>
              <FrostedSelect
                value="live_video"
                onChange={(value) => {
                  if (value === "style_replication" || value === "multi_prompt") onModeChange(value);
                }}
                options={[
                  { value: "style_replication", label: text("batch.modeReplication") },
                  { value: "multi_prompt", label: text("batch.modeMulti") },
                  { value: "live_video", label: text("batch.modeLive") },
                ]}
                showLeading={false}
                side="bottom"
                ariaLabel={text("workspaceFollowup.me4b76edd446f")}
              />
            </div>

            <BatchMediaGallery
              label="图片素材"
              relations={relations}
              busy={controller.uploading}
              disabled={controller.creating}
              multiple
              dropzone
              dropzoneSize="large"
              compactHeaderActions
              showSummary
              maxFiles={LIVE_VIDEO_BATCH_MAX_MEDIA}
              hint={text("workspaceFollowup.m64dde2a48a41", { v0: controller.settings.duration || 4 })}
              onUpload={(files) => {
                if (relations.length + files.length > LIVE_VIDEO_BATCH_MAX_MEDIA) {
                  controller.setError(text("workspaceFollowup.meccf37fe809b"));
                  return;
                }
                void controller.upload(files);
              }}
              onImportProductLibraryItem={(drop) => void controller.importProductLibraryItem(drop)}
              onRemove={(relation) => controller.removeMedia(relation.id)}
              onClear={controller.clearMedia}
              onLimitExceeded={() => controller.setError(text("workspaceFollowup.meccf37fe809b"))}
            />

            <section className="flex min-h-24 flex-1 flex-col">
              <div className="mb-2 flex min-h-6 items-center justify-between gap-2">
                <span className="text-[13px] font-semibold text-[var(--app-fg)]"><UiText id="batch.m4b47dbae97ba" /></span>
                <RoleSkillTrigger
                  onClick={() => accountId ? setSkillDialogOpen(true) : openLoginModal()}
                  selected={Boolean(controller.selectedSkillId)}
                  disabled={controller.creating}
                />
              </div>
              <UiProps ids={{"placeholder":["batch.m1f6045454d24"]}}><ExpandablePromptTextarea
                value={controller.sharedRequirement}
                assets={promptAssets}
                roleSkills={skills}
                roleSkillsLoading={skillsLoading}
                roleSkillsError={skillsError}
                onRoleSkillSelect={(skill) => controller.setSelectedSkillId(skill.id)}
                leadingToken={controller.overrideSkillId && selectedSkill ? (
                  <UiProps ids={{"title":["batch.mf84fb4d983db"]}}><button
                    type="button"
                    data-live-video-role-skill-token=""
                    onClick={() => controller.setSelectedSkillId("")}
                    aria-label={text("workspaceFollowup.m4ae24c539ca3", { v0: selectedSkill.name })}
                    title="batch.mf84fb4d983db"
                    className="inline-flex max-w-[180px] items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--panel-2)] px-1.5 py-1 text-xs font-medium leading-none text-[var(--primary-bg)] transition hover:border-[var(--primary-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_srgb,var(--primary-bg)_35%,transparent)]"
                  >
                    <span className="truncate">{selectedSkill.name}</span>
                    <X className="h-3 w-3 shrink-0" aria-hidden="true" />
                  </button></UiProps>
                ) : undefined}
                disabled={controller.creating}
                onChange={controller.setSharedRequirement}
                maxLength={2000}
                placeholder="batch.m1f6045454d24"
                className="min-h-0 flex-1"
              /></UiProps>
            </section>
          </div>

          <div className="shrink-0 space-y-3 border-t border-[var(--border)] bg-[var(--panel-bg)] p-4">
            {controller.models.length ? (
              <LiveVideoParameterDock
                settings={controller.settings}
                models={controller.models}
                disabled={controller.creating || controller.uploading}
                onChange={controller.setSettings}
              />
            ) : (
              <p className="rounded-xl border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs leading-5 text-amber-500"><UiText id="batch.m13246e7002bd" /></p>
            )}
            <GenerateActionButton
              variant="primary"
              busy={controller.creating}
              disabled={createDisabled}
              onClick={() => accountId ? void controller.createBatch() : openLoginModal()}
              className="h-12 w-full px-5"
            >
              {controller.creating ? <UiText id="batch.mc28aa6ae4777" /> : <UiText id="batch.m1217dab9dbde" values={{v0: String(relations.length)}} />}
            </GenerateActionButton>
          </div>
        </aside>

      </div>

      <RoleSkillDialog
        open={skillDialogOpen}
        authUserId={accountId}
        selectedRoleSkillId={controller.selectedSkillId || null}
        resultRoleSkillId={null}
        legacySystemPrompt=""
        generating={false}
        generateDisabledReason={text("workspaceFollowup.m7e86bff3d703")}
        showApplyResult={false}
        onClose={() => setSkillDialogOpen(false)}
        onSelect={(skill) => {
          controller.setSelectedSkillId(skill.id);
          setSkillDialogOpen(false);
        }}
        onClearSelection={() => controller.setSelectedSkillId("")}
        onGenerate={() => undefined}
        onApplyResult={() => undefined}
        result={(
          <div className="flex h-full min-h-[220px] flex-col items-center justify-center rounded-xl border border-dashed border-[var(--border)] bg-[var(--panel-bg)] px-6 text-center">
            <Sparkles className="h-6 w-6 text-[var(--primary-bg)]" />
            <p className="mt-3 text-sm font-medium text-[var(--app-fg)]"><UiText id="batch.md75f8e2723f0" /></p>
            <p className="mt-2 text-xs leading-5 text-[var(--app-muted)]"><UiText id="batch.m46c5057aaab5" /></p>
          </div>
        )}
      />

      <UiProps ids={{"title":["batch.m79be13bdf0c5"],"confirmText":["batch.m3fd47edce45b"]}}><ConfirmDialog
        open={Boolean(controller.error)}
        title="batch.m79be13bdf0c5"
        confirmText="batch.m3fd47edce45b"
        showCancel={false}
        danger
        onClose={() => controller.setError("")}
        onConfirm={() => controller.setError("")}
      >
        <p className="whitespace-pre-line text-sm leading-6 text-[var(--app-muted)]">{uiError(controller.error)}</p>
      </ConfirmDialog></UiProps>

      <UiProps ids={{"title":["batch.m6c1bb7935779"],"description":["batch.m0e6a1f27b8ef"],"confirmText":["batch.m2f9daa828907"]}}><ConfirmDialog
        open={Boolean(deleteBatchId)}
        title="batch.m6c1bb7935779"
        description="batch.m0e6a1f27b8ef"
        confirmText="batch.m2f9daa828907"
        danger
        onClose={() => setDeleteBatchId("")}
        onConfirm={async () => {
          if (!deleteBatchId) return;
          await controller.deleteBatch(deleteBatchId);
          setDeleteBatchId("");
        }}
      /></UiProps>
    </div>
    </AtomicPageReveal>
  );
}
