"use client";
import { UiProps, UiText } from "@/i18n/ui";


import * as React from "react";
import { ChevronDown, ChevronUp, FileText, Pencil, RotateCcw, Star, Trash2, X } from "lucide-react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import {
  RoleSkillContentFormatToggle,
  RoleSkillFormattedChunk,
  RoleSkillSourceContent,
  splitRoleSkillPreviewMarkdown,
} from "@/components/role-skills/role-skill-content-view";
import { SkillWorkspaceFilePicker } from "@/components/role-skills/skill-workspace-file-picker";
import { SkeletonText } from "@/components/ui/skeleton";
import type {
  RoleSkillDetail,
  RoleSkillListItem,
} from "@/lib/role-skills/contracts";
import {
  createDefaultSkillWorkspace,
  getSkillWorkspaceBaseName,
  isMarkdownFileName,
} from "@/lib/role-skills/skill-workspace";

export { formatRoleSkillPreviewMarkdown } from "@/components/role-skills/role-skill-content-view";

type DetailItem =
  | { type: "introduction" }
  | { type: "skill-header" }
  | { type: "loading" }
  | { type: "preview"; content: string; last: boolean }
  | { type: "source"; content: string };

export function RoleSkillDetailView({
  skill,
  loading = false,
  protectContent = false,
  onClose,
  onEdit,
  onDelete,
  onRestore,
  metadata,
  error,
  favorite = false,
  onToggleFavorite,
  downloadAction,
}: {
  skill: RoleSkillListItem | RoleSkillDetail;
  loading?: boolean;
  protectContent?: boolean;
  onClose(): void;
  onEdit?(): void;
  onDelete?(): void;
  onRestore?(): void;
  metadata?: React.ReactNode;
  error?: string | null;
  favorite?: boolean;
  onToggleFavorite?(): void;
  downloadAction?: React.ReactNode;
}) {
  const [format, setFormat] = React.useState<"preview" | "source">("preview");
  const virtuosoRef = React.useRef<VirtuosoHandle>(null);
  const fallbackContent = "content" in skill ? skill.content : "";
  const workspace = "content" in skill && skill.workspace
    ? skill.workspace
    : createDefaultSkillWorkspace(fallbackContent);
  const workspaceKey = workspace.files.map((file) => file.path).join("\u0000");
  const [selectedPath, setSelectedPath] = React.useState(
    workspace.primaryPath || workspace.files[0]?.path || "",
  );
  const selectedFile = workspace.files.find((file) => file.path === selectedPath)
    || workspace.files[0]
    || null;
  const content = selectedFile?.content || "";
  const markdownFile = Boolean(selectedFile && isMarkdownFileName(selectedFile.path));
  const visibleFormat = markdownFile ? format : "source";
  const contentProtected = protectContent;
  const previewChunks = React.useMemo(
    () => splitRoleSkillPreviewMarkdown(content),
    [content],
  );
  const detailItems = React.useMemo<DetailItem[]>(() => {
    const leadingItems: DetailItem[] = [
      { type: "introduction" },
      { type: "skill-header" },
    ];
    const contentItems: DetailItem[] = loading
      ? [{ type: "loading" }]
      : visibleFormat === "preview"
        ? previewChunks.map((chunk, index) => ({
            type: "preview" as const,
            content: chunk,
            last: index === previewChunks.length - 1,
          }))
        : [{ type: "source", content }];
    return [...leadingItems, ...contentItems];
  }, [content, loading, previewChunks, visibleFormat]);

  React.useEffect(() => {
    setSelectedPath(workspace.primaryPath || workspace.files[0]?.path || "");
    setFormat("preview");
    virtuosoRef.current?.scrollToIndex({ index: 0, align: "start" });
  }, [skill.id, workspace.primaryPath, workspaceKey]);

  React.useEffect(() => {
    setFormat(markdownFile ? "preview" : "source");
    virtuosoRef.current?.scrollToIndex({ index: 0, align: "start" });
  }, [markdownFile, selectedPath]);

  return (
    <div
      aria-busy={loading}
      className="flex min-h-0 flex-1 flex-col bg-[var(--panel-bg)]"
    >
      <div className="w-full shrink-0 px-5 pt-5 sm:px-7 sm:pt-6">
        <header className="flex items-start justify-between gap-5 border-b border-[var(--border)] pb-5">
          <div className="min-w-0">
            <h2 className="text-xl font-bold text-[var(--app-fg)] sm:text-2xl">
              {skill.name}
            </h2>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-[var(--app-muted)]">
              <span className="rounded-full border border-[var(--border)] bg-[var(--panel-2)] px-2.5 py-1">
                {skill.category}
              </span>
              {metadata}
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          {downloadAction}
          {onToggleFavorite && (
            <UiProps ids={{"aria-label":["common.mdca60869e7d2","common.m60a53514eb92"],"title":["common.mdca60869e7d2","common.m60a53514eb92"]}}><button
              type="button"
              onClick={onToggleFavorite}
              aria-label={favorite ? "common.mdca60869e7d2" : "common.m60a53514eb92"}
              title={favorite ? "common.mdca60869e7d2" : "common.m60a53514eb92"}
              aria-pressed={favorite}
              className="inline-flex h-8 w-8 items-center justify-center rounded-[9px] border border-[var(--canvas-controls-border,var(--border))] bg-transparent text-[var(--app-muted)] transition hover:bg-[var(--canvas-controls-hover,var(--panel-2))] hover:text-[var(--app-fg)] aria-pressed:bg-[var(--panel-2)] aria-pressed:text-[var(--app-fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary-bg)]"
            >
              <Star size={14} strokeWidth={1.5} fill={favorite ? "currentColor" : "none"} />
            </button></UiProps>
          )}
          <>
            {onEdit && <button type="button" onClick={onEdit} disabled={loading} className="inline-flex h-8 items-center gap-1 rounded-[9px] border border-[var(--canvas-controls-border,var(--border))] bg-transparent px-[11px] text-sm text-[var(--app-muted)] transition hover:bg-[var(--canvas-controls-hover,var(--panel-2))] hover:text-[var(--app-fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary-bg)] disabled:opacity-50"><Pencil size={14} strokeWidth={1.5} /><UiText id="common.m051836569928" /></button>}
            {onDelete && <button type="button" onClick={onDelete} disabled={loading} className="inline-flex h-8 items-center gap-1 rounded-[9px] border border-[var(--canvas-controls-border,var(--border))] bg-transparent px-[11px] text-sm text-[var(--app-muted)] transition hover:bg-[var(--canvas-controls-hover,var(--panel-2))] hover:text-[var(--app-fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary-bg)] disabled:opacity-50"><Trash2 size={14} strokeWidth={1.5} /><UiText id="common.m2f9daa828907" /></button>}
            {onRestore && <button type="button" onClick={onRestore} disabled={loading} className="inline-flex h-8 items-center gap-1 rounded-[9px] border border-[var(--border)] px-[11px] text-sm text-[var(--app-muted)] hover:bg-[var(--panel-2)] disabled:opacity-50"><RotateCcw size={14} /><UiText id="common.me0534b8a4e46" /></button>}
          </>
          <UiProps ids={{"aria-label":["common.mf0add5a61bf1"]}}><button
            type="button"
            onClick={onClose}
            aria-label="common.mf0add5a61bf1"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] border border-[var(--canvas-controls-border,var(--border))] bg-transparent text-[var(--app-muted)] transition hover:bg-[var(--canvas-controls-hover,var(--panel-2))] hover:text-[var(--app-fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary-bg)]"
          >
            <X size={14} strokeWidth={1.5} />
          </button></UiProps>
          </div>
        </header>
        {error ? <p role="alert" className="py-2 text-xs text-red-500">{error}</p> : null}
      </div>

      <div
        onCopy={contentProtected ? preventContentTransfer : undefined}
        onCut={contentProtected ? preventContentTransfer : undefined}
        onDragStart={contentProtected ? preventContentTransfer : undefined}
        className={[
          "role-skill-detail-scroll-shell relative min-h-0 flex-1",
          contentProtected ? "select-none" : "",
        ].join(" ")}
      >
        <Virtuoso
          id="role-skill-detail-scroll"
          ref={virtuosoRef}
          className="role-skill-detail-scrollbar"
          data={detailItems}
          style={{ height: "100%" }}
          computeItemKey={(index, item) =>
            item.type === "preview" ? `preview-${index}` : item.type
          }
          increaseViewportBy={{ top: 320, bottom: 640 }}
          minOverscanItemCount={{ top: 2, bottom: 4 }}
          components={{ Footer: DetailFooter }}
          itemContent={(_index, item) => {
            if (item.type === "introduction") {
              return (
                <div className="w-full px-5 sm:px-7">
                  <section
                    aria-labelledby="skill-introduction"
                    className="pt-4"
                  >
                    <h3
                      id="skill-introduction"
                      className="text-base font-semibold text-[var(--app-fg)]"
                    ><UiText id="common.m8131eafd0239" /></h3>
                    <dl className="mt-2">
                      <UiProps ids={{"label":["common.m66a66f52a2b1"]}}><DetailRow label="common.m66a66f52a2b1" value={skill.summary} /></UiProps>
                      <UiProps ids={{"label":["common.m100587977125"]}}><DetailRow label="common.m100587977125" value={skill.usageScenario} /></UiProps>
                      <UiProps ids={{"label":["common.m26eb7cff0f41"]}}><DetailRow label="common.m26eb7cff0f41" value={skill.usageGuide} /></UiProps>
                    </dl>
                  </section>
                </div>
              );
            }

            if (item.type === "skill-header") {
              return (
                <div className="w-full px-5 pt-7 sm:px-7">
                  <section aria-labelledby="skill-content">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <h3
                        id="skill-content"
                        className="text-base font-semibold text-[var(--app-fg)]"
                      >
                        Skill
                      </h3>
                      <div className="flex items-center gap-3 text-xs text-[var(--app-muted)]">
                        <span>{workspace.files.length}<UiText id="common.mff7a7e19a5bf" /></span>
                        {workspace.files.length > 1 || workspace.directories.length > 0 ? (
                          <SkillWorkspaceFilePicker
                            workspace={workspace}
                            value={selectedFile?.path || ""}
                            onChange={setSelectedPath}
                          />
                        ) : (
                          <span className="inline-flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--panel-2)] px-3 py-2 text-[var(--app-fg)]">
                            <FileText className="h-3.5 w-3.5" />
                            {selectedFile ? getSkillWorkspaceBaseName(selectedFile.path) : <UiText id="common.me036abb578a3" />}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="mt-3 overflow-hidden rounded-t-2xl border-x border-t border-[var(--border)] bg-[var(--panel-2)]">
                      <div className="flex justify-end border-b border-[var(--border)] px-3 py-2.5">
                        {markdownFile ? (
                          <RoleSkillContentFormatToggle
                            value={visibleFormat}
                            onChange={setFormat}
                          />
                        ) : null}
                      </div>
                    </div>
                  </section>
                </div>
              );
            }

            if (item.type === "loading") {
              return (
                <div className="mx-5 rounded-b-2xl border-x border-b border-[var(--border)] bg-[var(--panel-2)] px-5 py-6 sm:mx-7 sm:px-6">
                  <UiProps ids={{"aria-label":["common.m2ba382fca2a1"]}}><div role="status" aria-label="common.m2ba382fca2a1">
                    <SkeletonText lines={8} />
                  </div></UiProps>
                </div>
              );
            }

            if (item.type === "source") {
              return (
                <div className="mx-5 overflow-hidden rounded-b-2xl border-x border-b border-[var(--border)] bg-[var(--panel-2)] sm:mx-7">
                  <RoleSkillSourceContent content={item.content} />
                </div>
              );
            }

            return (
              <div
                className={[
                  "mx-5 border-x border-[var(--border)] bg-[var(--panel-2)] sm:mx-7",
                  item.last ? "rounded-b-2xl border-b" : "",
                ].join(" ")}
              >
                <RoleSkillFormattedChunk
                  content={item.content}
                  className={[
                    "px-5 pt-2 text-sm leading-7 text-[var(--app-fg)] sm:px-6",
                    item.last ? "pb-5 sm:pb-6" : "pb-2",
                  ].join(" ")}
                />
              </div>
            );
          }}
        />

        <UiProps ids={{"aria-label":["common.m593f885fed5c"]}}><button
          type="button"
          aria-label="common.m593f885fed5c"
          aria-controls="role-skill-detail-scroll"
          onClick={() => virtuosoRef.current?.scrollBy({ top: -48 })}
          className="absolute right-0 top-0 z-10 flex h-5 w-5 items-center justify-center bg-[var(--role-skill-scrollbar-track)] text-[var(--role-skill-scrollbar-thumb)] transition hover:text-[var(--app-fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--primary-bg)]"
        >
          <ChevronUp className="h-3 w-3" />
        </button></UiProps>
        <UiProps ids={{"aria-label":["common.mff41a24e06cb"]}}><button
          type="button"
          aria-label="common.mff41a24e06cb"
          aria-controls="role-skill-detail-scroll"
          onClick={() => virtuosoRef.current?.scrollBy({ top: 48 })}
          className="absolute bottom-0 right-0 z-10 flex h-5 w-5 items-center justify-center bg-[var(--role-skill-scrollbar-track)] text-[var(--role-skill-scrollbar-thumb)] transition hover:text-[var(--app-fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--primary-bg)]"
        >
          <ChevronDown className="h-3 w-3" />
        </button></UiProps>
      </div>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-2 py-2 text-sm sm:grid-cols-[84px_minmax(0,1fr)] sm:gap-3">
      <dt className="text-[var(--app-muted)]">{label}</dt>
      <dd className="whitespace-pre-wrap leading-5 font-medium text-[var(--app-fg)]">
        {value}
      </dd>
    </div>
  );
}

function DetailFooter() {
  return <div className="h-5 sm:h-6" />;
}

function preventContentTransfer(event: React.SyntheticEvent) {
  event.preventDefault();
}
