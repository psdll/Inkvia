"use client";

import { UiProps, UiText, useUiLocale } from "@/i18n/ui";


import * as React from "react";
import {
  ChevronDown,
  ChevronRight,
  FilePlus2,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  Maximize2,
  Minimize2,
  MoreHorizontal,
  Pencil,
  Pin,
  Plus,
  Trash2,
  Upload,
} from "lucide-react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { SkillMarkdownEditor } from "@/components/role-skills/skill-markdown-editor";
import {
  RoleSkillContentFormatToggle,
  type RoleSkillContentFormat,
} from "@/components/role-skills/role-skill-content-view";
import type { RoleSkillWorkspace } from "@/lib/role-skills/contracts";
import {
  getSkillWorkspaceBaseName,
  getSkillWorkspaceParentPath,
  isMarkdownFileName,
  joinSkillWorkspacePath,
  normalizeSkillWorkspace,
  normalizeSkillWorkspacePath,
} from "@/lib/role-skills/skill-workspace";

type NamingAction = {
  kind: "file" | "folder" | "rename-file" | "rename-folder";
  parentPath: string;
  targetPath?: string;
  selectAsDestination?: boolean;
};

type PlacementAction =
  | { kind: "file" | "folder" }
  | { kind: "upload"; includeRelativePaths: boolean };

type DeleteTarget = {
  kind: "file" | "folder";
  path: string;
};

function comparePaths(left: string, right: string) {
  return left.localeCompare(right, "zh-CN");
}

function firstFilePath(workspace: RoleSkillWorkspace) {
  return workspace.files.map((file) => file.path).sort(comparePaths)[0] || "";
}

function directDirectories(workspace: RoleSkillWorkspace, parentPath: string) {
  return workspace.directories
    .filter((path) => getSkillWorkspaceParentPath(path) === parentPath)
    .sort(comparePaths);
}

function directFiles(workspace: RoleSkillWorkspace, parentPath: string) {
  return workspace.files
    .filter((file) => getSkillWorkspaceParentPath(file.path) === parentPath)
    .sort((left, right) => comparePaths(left.path, right.path));
}

function pathIsInside(path: string, directory: string) {
  return path === directory || path.startsWith(`${directory}/`);
}

function workspaceWithParents(workspace: RoleSkillWorkspace) {
  if (workspace.files.length === 0) {
    return {
      ...workspace,
      directories: Array.from(new Set(workspace.directories)).sort(comparePaths),
      primaryPath: null,
    };
  }
  return normalizeSkillWorkspace(workspace);
}

export function SystemSkillContentWorkspace({
  value,
  onChange,
  disabled = false,
  fillHeight = false,
}: {
  value: RoleSkillWorkspace;
  onChange: (value: RoleSkillWorkspace) => void;
  disabled?: boolean;
  fillHeight?: boolean;
}) {
  const { text, error: localizeError } = useUiLocale();
  const [view, setView] = React.useState<RoleSkillContentFormat>("preview");
  const [uploadOpen, setUploadOpen] = React.useState(false);
  const [fullscreen, setFullscreen] = React.useState(false);
  const [error, setError] = React.useState("");
  const [activePath, setActivePath] = React.useState(
    value.primaryPath || firstFilePath(value),
  );
  const [selectedDirectory, setSelectedDirectory] = React.useState("");
  const [expandedDirectories, setExpandedDirectories] = React.useState<Set<string>>(
    () => new Set(value.directories),
  );
  const [openMenuPath, setOpenMenuPath] = React.useState("");
  const [namingAction, setNamingAction] = React.useState<NamingAction | null>(null);
  const [nameValue, setNameValue] = React.useState("");
  const [deleteTarget, setDeleteTarget] = React.useState<DeleteTarget | null>(null);
  const [placementAction, setPlacementAction] = React.useState<PlacementAction | null>(null);
  const [placementDirectory, setPlacementDirectory] = React.useState<string | null>(null);
  const [uploading, setUploading] = React.useState(false);
  const uploadDestinationRef = React.useRef<string | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const directoryInputRef = React.useRef<HTMLInputElement>(null);
  const uploadMenuRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (activePath && value.files.some((file) => file.path === activePath)) return;
    setActivePath(value.primaryPath || firstFilePath(value));
  }, [activePath, value.files, value.primaryPath]);

  React.useEffect(() => {
    if (!selectedDirectory || value.directories.includes(selectedDirectory)) return;
    setSelectedDirectory("");
  }, [selectedDirectory, value.directories]);

  React.useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!uploadMenuRef.current?.contains(event.target as Node)) setUploadOpen(false);
      const target = event.target as HTMLElement | null;
      if (!target?.closest("[data-workspace-menu]")) setOpenMenuPath("");
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setUploadOpen(false);
        setOpenMenuPath("");
        setFullscreen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  const activeFile = value.files.find((file) => file.path === activePath) || null;
  const canPreview = Boolean(activeFile && isMarkdownFileName(activeFile.path));
  const visibleView = canPreview ? view : "source";

  const emit = React.useCallback((workspace: RoleSkillWorkspace) => {
    try {
      const next = workspaceWithParents(workspace);
      onChange(next);
      setError("");
      return next;
    } catch (workspaceError) {
      setError(workspaceError instanceof Error ? workspaceError.message : "技能目录更新失败");
      return null;
    }
  }, [onChange]);

  const openNaming = (action: NamingAction) => {
    setNamingAction(action);
    setNameValue(action.targetPath ? getSkillWorkspaceBaseName(action.targetPath) : "");
    setOpenMenuPath("");
    setError("");
  };

  const openPlacement = (action: PlacementAction) => {
    if (disabled || uploading) return;
    uploadDestinationRef.current = null;
    setPlacementAction(action);
    setPlacementDirectory(null);
    setUploadOpen(false);
    setError("");
  };

  const submitNaming = () => {
    if (!namingAction || disabled) return false;
    try {
      if (namingAction.parentPath && !value.directories.includes(namingAction.parentPath)) {
        throw new Error("目标文件夹已不存在，请重新选择");
      }
      const nextPath = joinSkillWorkspacePath(namingAction.parentPath, nameValue);
      if (nextPath !== namingAction.targetPath && (
        value.files.some((file) => file.path === nextPath) || value.directories.includes(nextPath)
      )) throw new Error(`该位置已存在同名文件或文件夹：${nextPath}`);
      if (namingAction.kind === "file") {
        const next = emit({
          ...value,
          files: [...value.files, { path: nextPath, content: "" }],
        });
        if (!next) return false;
        setActivePath(nextPath);
        setSelectedDirectory(namingAction.parentPath);
        setView("source");
      } else if (namingAction.kind === "folder") {
        const next = emit({
          ...value,
          directories: [...value.directories, nextPath],
        });
        if (!next) return false;
        setSelectedDirectory(nextPath);
        setExpandedDirectories((current) => new Set(current).add(nextPath));
        if (namingAction.selectAsDestination) setPlacementDirectory(nextPath);
      } else if (namingAction.targetPath) {
        const oldPath = normalizeSkillWorkspacePath(namingAction.targetPath);
        if (namingAction.kind === "rename-file") {
          const next = emit({
            ...value,
            files: value.files.map((file) =>
              file.path === oldPath ? { ...file, path: nextPath } : file,
            ),
            primaryPath: value.primaryPath === oldPath ? nextPath : value.primaryPath,
          });
          if (!next) return false;
          if (activePath === oldPath) setActivePath(nextPath);
        } else {
          const replacePrefix = (path: string) =>
            pathIsInside(path, oldPath) ? `${nextPath}${path.slice(oldPath.length)}` : path;
          const next = emit({
            files: value.files.map((file) => ({
              ...file,
              path: replacePrefix(file.path),
            })),
            directories: value.directories.map(replacePrefix),
            primaryPath: value.primaryPath ? replacePrefix(value.primaryPath) : null,
          });
          if (!next) return false;
          setExpandedDirectories((current) => {
            const renamed = new Set<string>();
            current.forEach((path) => renamed.add(replacePrefix(path)));
            renamed.add(nextPath);
            return renamed;
          });
          if (selectedDirectory && pathIsInside(selectedDirectory, oldPath)) {
            setSelectedDirectory(replacePrefix(selectedDirectory));
          }
          if (activePath && pathIsInside(activePath, oldPath)) {
            setActivePath(replacePrefix(activePath));
          }
        }
      }
      if (namingAction.parentPath) {
        setExpandedDirectories((current) => {
          const expanded = new Set(current);
          const parts = namingAction.parentPath.split("/");
          parts.forEach((_, index) => expanded.add(parts.slice(0, index + 1).join("/")));
          return expanded;
        });
      }
      setNamingAction(null);
      return true;
    } catch (namingError) {
      setError(namingError instanceof Error ? namingError.message : "名称无效");
      return false;
    }
  };

  const confirmDelete = () => {
    if (!deleteTarget) return true;
    const deletingDirectory = deleteTarget.kind === "folder";
    const files = value.files.filter((file) =>
      deletingDirectory
        ? !pathIsInside(file.path, deleteTarget.path)
        : file.path !== deleteTarget.path,
    );
    const directories = value.directories.filter((directory) =>
      deletingDirectory ? !pathIsInside(directory, deleteTarget.path) : true,
    );
    const primaryPath = value.primaryPath && files.some((file) => file.path === value.primaryPath)
      ? value.primaryPath
      : files.map((file) => file.path).sort(comparePaths)[0] || null;
    const next = emit({ files, directories, primaryPath });
    if (!next) return false;
    if (!files.some((file) => file.path === activePath)) {
      setActivePath(primaryPath || "");
    }
    if (deletingDirectory && pathIsInside(selectedDirectory, deleteTarget.path)) {
      setSelectedDirectory(getSkillWorkspaceParentPath(deleteTarget.path));
    }
    setDeleteTarget(null);
    return true;
  };

  const addUploadedFiles = async (files: File[], includeRelativePaths: boolean, destination: string) => {
    if (!files.length || disabled) return false;
    setUploading(true);
    try {
      if (destination && !value.directories.includes(destination)) {
        throw new Error("目标文件夹已不存在，请重新选择");
      }
      const uploaded = await Promise.all(files.map(async (file) => {
        const rawPath = includeRelativePaths
          ? file.webkitRelativePath || file.name
          : file.name;
        const relativePath = normalizeSkillWorkspacePath(rawPath);
        const targetPath = destination
          ? normalizeSkillWorkspacePath(`${destination}/${relativePath}`)
          : relativePath;
        const bytes = await file.arrayBuffer();
        let content: string;
        try {
          // Detect text by its contents, not its extension or browser-provided MIME type.
          content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        } catch {
          throw new Error(`文件 ${file.name} 不是可读取文本，请使用 UTF-8 文本文件`);
        }
        if (content.includes("\u0000")) {
          throw new Error(`文件 ${file.name} 不是可读取文本`);
        }
        return { path: targetPath, content };
      }));
      const next = emit({
        ...value,
        files: [...value.files, ...uploaded],
      });
      if (!next) return false;
      setSelectedDirectory(destination);
      setActivePath(uploaded[0]?.path || activePath);
      setExpandedDirectories((current) => {
        const expanded = new Set(current);
        next.directories.forEach((directory) => expanded.add(directory));
        return expanded;
      });
      setView(isMarkdownFileName(uploaded[0]?.path || "") ? "preview" : "source");
      setUploadOpen(false);
      setPlacementAction(null);
      return true;
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "文件读取失败");
      return false;
    } finally {
      setUploading(false);
    }
  };

  const confirmPlacement = () => {
    if (!placementAction || placementDirectory === null || disabled || uploading) return false;
    if (placementDirectory && !value.directories.includes(placementDirectory)) {
      setError("目标文件夹已不存在，请重新选择");
      return false;
    }
    if (placementAction.kind === "upload") {
      uploadDestinationRef.current = placementDirectory;
      if (placementAction.includeRelativePaths) directoryInputRef.current?.click();
      else fileInputRef.current?.click();
      return false;
    }
    openNaming({ kind: placementAction.kind, parentPath: placementDirectory });
    return true;
  };

  const toggleDirectory = (path: string) => {
    setSelectedDirectory(path);
    setExpandedDirectories((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const directoryAttributes = {
    webkitdirectory: "",
    directory: "",
  } as React.InputHTMLAttributes<HTMLInputElement>;

  return (
    <UiProps ids={{"aria-label":["common.m4ead3e3b25e9"]}}><section
      aria-label="common.m4ead3e3b25e9"
      className={fullscreen
        ? "system-skill-workspace fixed inset-4 z-[120] flex min-h-0 flex-col rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] p-5 shadow-2xl"
        : `system-skill-workspace flex min-h-0 min-w-0 flex-col ${fillHeight ? "flex-1" : ""}`
      }
    >
      <div className="mb-3 flex shrink-0 flex-wrap items-center justify-between gap-3">
        <div className="text-xs font-medium text-[var(--app-fg)]"><UiText id="common.mde749b669a1e" /><span className="ml-1 text-red-500">*</span>
        </div>

        <div className="flex items-center gap-1 text-xs text-[var(--app-muted)]">
          <RoleSkillContentFormatToggle
            value={visibleView}
            onChange={setView}
            variant="editor"
          />
          <span className="mx-2 h-5 w-px bg-[var(--border)]" aria-hidden="true" />
          <div ref={uploadMenuRef} className="relative">
            <button
              type="button"
              aria-haspopup="menu"
              aria-expanded={uploadOpen}
              disabled={disabled || uploading}
              onClick={() => setUploadOpen((open) => !open)}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-[var(--app-fg)] hover:bg-[var(--panel-2)]"
            >
              <Upload className="h-4 w-4" /><UiText id="common.m9e07e3c0532d" /><ChevronDown className="h-3.5 w-3.5" />
            </button>
            {uploadOpen ? (
              <div role="menu" className="absolute right-0 top-9 z-30 w-36 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--panel-bg)] p-1 shadow-xl">
                <button type="button" role="menuitem" onClick={() => openPlacement({ kind: "upload", includeRelativePaths: false })} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-[var(--app-fg)] hover:bg-[var(--panel-2)]">
                  <FileText className="h-4 w-4" /><UiText id="common.mbb5caa9c5976" /></button>
                <button type="button" role="menuitem" onClick={() => openPlacement({ kind: "upload", includeRelativePaths: true })} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-[var(--app-fg)] hover:bg-[var(--panel-2)]">
                  <FolderPlus className="h-4 w-4" /><UiText id="common.mcf330aa2e05e" /></button>
              </div>
            ) : null}
          </div>

          <UiProps ids={{"aria-label":["common.m290f68030501","common.m80f8fbcfa011"],"title":["common.m290f68030501","common.m80f8fbcfa011"]}}><button type="button" onClick={() => setFullscreen((current) => !current)} aria-label={fullscreen ? "common.m290f68030501" : "common.m80f8fbcfa011"} title={fullscreen ? "common.m290f68030501" : "common.m80f8fbcfa011"} className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-[var(--panel-2)] hover:text-[var(--app-fg)]">
            {fullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </button></UiProps>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="sr-only"
        onChange={(event) => {
          const destination = uploadDestinationRef.current;
          uploadDestinationRef.current = null;
          if (destination !== null) void addUploadedFiles(Array.from(event.currentTarget.files || []), false, destination);
          event.currentTarget.value = "";
        }}
      />
      <input
        ref={directoryInputRef}
        type="file"
        multiple
        {...directoryAttributes}
        className="sr-only"
        onChange={(event) => {
          const destination = uploadDestinationRef.current;
          uploadDestinationRef.current = null;
          if (destination !== null) void addUploadedFiles(Array.from(event.currentTarget.files || []), true, destination);
          event.currentTarget.value = "";
        }}
      />

      <div className={fullscreen
        ? "grid min-h-0 flex-1 grid-cols-[240px_minmax(0,1fr)] gap-3 max-md:grid-cols-[160px_minmax(0,1fr)]"
        : fillHeight
          ? "grid min-h-0 flex-1 grid-cols-[240px_minmax(0,1fr)] gap-3 max-xl:grid-cols-[200px_minmax(0,1fr)] max-md:grid-cols-1 max-md:grid-rows-[auto_minmax(0,1fr)]"
          : "grid h-[28rem] min-h-0 grid-cols-[minmax(210px,28%)_minmax(0,1fr)] gap-2 max-md:h-auto max-md:grid-cols-1"
      }>
        <aside className={`${fillHeight ? "max-md:max-h-48" : ""} min-h-0 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--panel-bg)]`}>
          <div className="flex h-12 items-center justify-between px-3 text-xs text-[var(--app-muted)]">
            <UiProps ids={{"title":["common.ma795bc589bfc"]}}><button
              type="button"
              onClick={() => setSelectedDirectory("")}
              className={selectedDirectory ? "hover:text-[var(--app-fg)]" : "font-medium text-[var(--app-fg)]"}
              title="common.ma795bc589bfc"
            ><UiText id="common.m52daa71ebc31" /></button></UiProps>
            <div className="flex items-center gap-1">
              <span className="mr-1">{value.files.length}<UiText id="common.mff7a7e19a5bf" /></span>
              <UiProps ids={{"aria-label":["common.m84244abc71de"],"title":["common.m84244abc71de"]}}><button
                type="button"
                disabled={disabled}
                onClick={() => openPlacement({ kind: "folder" })}
                aria-label="common.m84244abc71de"
                title="common.m84244abc71de"
                className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-[var(--panel-2)] hover:text-[var(--app-fg)]"
              >
                <FolderPlus className="h-4 w-4" />
              </button></UiProps>
              <UiProps ids={{"aria-label":["common.m6ddd1eaccab1"],"title":["common.m6ddd1eaccab1"]}}><button
                type="button"
                disabled={disabled}
                onClick={() => openPlacement({ kind: "file" })}
                aria-label="common.m6ddd1eaccab1"
                title="common.m6ddd1eaccab1"
                className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-[var(--panel-2)] hover:text-[var(--app-fg)]"
              >
                <FilePlus2 className="h-4 w-4" />
              </button></UiProps>
            </div>
          </div>
          <div className="h-[calc(100%-3rem)] overflow-y-auto px-2 pb-2">
            {value.files.length || value.directories.length ? (
              <WorkspaceTreeLevel
                workspace={value}
                parentPath=""
                depth={0}
                activePath={activePath}
                selectedDirectory={selectedDirectory}
                expandedDirectories={expandedDirectories}
                openMenuPath={openMenuPath}
                onToggleDirectory={toggleDirectory}
                onSelectFile={(path) => {
                  setActivePath(path);
                  setSelectedDirectory(getSkillWorkspaceParentPath(path));
                  setView(isMarkdownFileName(path) ? "preview" : "source");
                }}
                onOpenMenu={setOpenMenuPath}
                onRename={(kind, path) => openNaming({
                  kind: kind === "file" ? "rename-file" : "rename-folder",
                  parentPath: getSkillWorkspaceParentPath(path),
                  targetPath: path,
                })}
                onDelete={(kind, path) => {
                  setDeleteTarget({ kind, path });
                  setOpenMenuPath("");
                }}
                onPin={(path) => {
                  emit({ ...value, primaryPath: path });
                  setOpenMenuPath("");
                }}
              />
            ) : (
              <div className="rounded-lg border border-dashed border-[var(--border)] px-3 py-8 text-center text-xs text-[var(--app-muted)]"><UiText id="common.m10a8258c8b06" /></div>
            )}
          </div>
        </aside>

        <div className="relative min-h-0 overflow-hidden">
          {activeFile ? (
            <SkillMarkdownEditor
              disabled={disabled}
              key={activeFile.path}
              value={activeFile.content}
              allowPreview={canPreview}
              mode={visibleView}
              onModeChange={setView}
              showModeToggle={false}
              onChange={(content) => emit({
                ...value,
                files: value.files.map((file) =>
                  file.path === activeFile.path ? { ...file, content } : file,
                ),
              })}
              className={`system-skill-workspace-content-scroll h-full ${fillHeight || fullscreen ? "!min-h-0" : ""}`}
            />
          ) : (
            <div className="flex h-full min-h-[20rem] items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--input-bg)] px-6 text-center text-sm text-[var(--app-muted)]"><UiText id="common.m014526cb07e1" /></div>
          )}
          {error ? <div className="absolute inset-x-3 bottom-3 z-20 rounded-lg border border-red-500/25 bg-[var(--panel-bg)] px-3 py-2 text-xs text-red-500 shadow-lg">{localizeError(error)}</div> : null}
        </div>
      </div>

      <UiProps ids={{"title":["common.m0d6fad8138e7"],"confirmText":["common.m593470c32d44","common.macfc4e74a650"]}}><ConfirmDialog
        open={Boolean(placementAction)}
        zIndex={210}
        title="common.m0d6fad8138e7"
        confirmText={uploading ? "common.m593470c32d44" : "common.macfc4e74a650"}
        confirmDisabled={disabled || uploading || placementDirectory === null}
        onClose={() => {
          if (uploading) return;
          uploadDestinationRef.current = null;
          setPlacementAction(null);
          setError("");
        }}
        onConfirm={confirmPlacement}
        headerActions={placementAction?.kind !== "folder" ? (
          <button type="button" disabled={disabled || uploading || placementDirectory === null}
            onClick={() => openNaming({ kind: "folder", parentPath: placementDirectory!, selectAsDestination: true })}
            className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs text-[var(--app-muted)] hover:bg-[var(--panel-2)] disabled:opacity-40">
            <Plus className="h-3.5 w-3.5" /><UiText id="common.m84244abc71de" /></button>
        ) : undefined}
      >
        <WorkspaceFolderSelection
          directories={value.directories}
          selected={placementDirectory}
          disabled={disabled || uploading}
          onSelect={(path) => { setPlacementDirectory(path); setError(""); }}
        />
        {placementDirectory !== null ? <p className="mt-3 break-all text-xs text-[var(--app-muted)]"><UiText id="common.me78f596d821e" />{placementDirectory ? <UiText id="common.m9ce015f1a6f3" values={{v0: String(placementDirectory.split("/").join(" / "))}} /> : <UiText id="common.m42ee2863b6d7" />}</p> : null}
        {error ? <p role="alert" className="mt-2 text-xs text-red-500">{localizeError(error)}</p> : null}
      </ConfirmDialog></UiProps>

      <UiProps ids={{"title":["common.m0d0cbac2eee5","common.m84244abc71de","common.m6ddd1eaccab1"],"confirmText":["common.mfac2a67ad878"]}}><ConfirmDialog
        open={Boolean(namingAction)}
        zIndex={220}
        title={namingAction?.kind.startsWith("rename") ? "common.m0d0cbac2eee5" : namingAction?.kind === "folder" ? "common.m84244abc71de" : "common.m6ddd1eaccab1"}
        confirmText="common.mfac2a67ad878"
        confirmDisabled={disabled || !nameValue.trim()}
        onClose={() => { setNamingAction(null); setError(""); }}
        onConfirm={submitNaming}
      >
        <p className="mb-3 break-all text-xs text-[var(--app-muted)]"><UiText id="common.m0871f0abbd53" />{namingAction?.parentPath ? <UiText id="common.m9ce015f1a6f3" values={{v0: String(namingAction.parentPath.split("/").join(" / "))}} /> : <UiText id="common.m42ee2863b6d7" />}</p>
        <UiProps ids={{"aria-label":["common.md44e9b3d3b31"],"placeholder":["common.mbacf701908d8","common.mfbc4cf580c57"]}}><input
          autoFocus
          aria-label="common.md44e9b3d3b31"
          value={nameValue}
          onChange={(event) => setNameValue(event.target.value)}
          placeholder={namingAction?.kind.includes("folder") ? "common.mbacf701908d8" : "common.mfbc4cf580c57"}
          className="h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--input-bg)] px-3 text-sm text-[var(--app-fg)] outline-none focus:border-[var(--primary-bg)]"
        /></UiProps>
        {error ? <p className="mt-2 text-xs text-red-500">{localizeError(error)}</p> : null}
      </ConfirmDialog></UiProps>

      <UiProps ids={{"title":["common.m780dfc4c1142","common.m88f47860e77d"],"confirmText":["common.m2f9daa828907"]}}><ConfirmDialog
        open={Boolean(deleteTarget)}
        zIndex={210}
        title={deleteTarget?.kind === "folder" ? "common.m780dfc4c1142" : "common.m88f47860e77d"}
        description={deleteTarget ? (deleteTarget.kind === "folder" ? text("createDynamic.m19edf011a4d1", { path: deleteTarget.path }) : text("createDynamic.m6d93e3d13f96", { path: deleteTarget.path })) : ""}
        confirmText="common.m2f9daa828907"
        danger
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
      /></UiProps>
    </section></UiProps>
  );
}

function WorkspaceFolderSelection({
  directories,
  selected,
  disabled,
  onSelect,
}: {
  directories: string[];
  selected: string | null;
  disabled: boolean;
  onSelect(path: string): void;
}) {
  const [expanded, setExpanded] = React.useState<Set<string>>(() => new Set(directories));

  React.useEffect(() => {
    if (!selected) return;
    setExpanded((current) => {
      const next = new Set(current);
      const parts = selected.split("/");
      parts.slice(0, -1).forEach((_, index) => next.add(parts.slice(0, index + 1).join("/")));
      return next;
    });
  }, [selected]);

  const renderFolders = (parent: string, depth = 0): React.ReactNode => directories
    .filter((path) => getSkillWorkspaceParentPath(path) === parent)
    .sort(comparePaths)
    .map((path) => {
      const isExpanded = expanded.has(path);
      const hasChildren = directories.some((child) => getSkillWorkspaceParentPath(child) === path);
      return <React.Fragment key={path}>
        <button type="button" disabled={disabled} aria-label={path} aria-pressed={selected === path} aria-expanded={hasChildren ? isExpanded : undefined}
          style={{ paddingLeft: depth * 18 + 8 }}
          className={`flex w-full min-w-0 items-center gap-3 rounded-xl py-3 pr-3 text-left text-sm text-[var(--app-fg)] ${selected === path ? "bg-[var(--panel-2)] ring-1 ring-inset ring-[var(--border)]" : "hover:bg-[var(--panel-2)]"}`}
          onClick={() => {
            onSelect(path);
            if (hasChildren) setExpanded((current) => {
              const next = new Set(current);
              if (next.has(path)) next.delete(path); else next.add(path);
              return next;
            });
          }}>
            <ChevronRight className={`h-4 w-4 shrink-0 text-[var(--app-muted)] ${isExpanded ? "rotate-90" : ""} ${hasChildren ? "" : "opacity-25"}`} />
            {isExpanded ? <FolderOpen className="h-6 w-6 shrink-0 text-[var(--app-muted)]" /> : <Folder className="h-6 w-6 shrink-0 text-[var(--app-muted)]" />}
            <span className="truncate">{getSkillWorkspaceBaseName(path)}</span>
            {selected === path ? <span className="ml-auto shrink-0 text-xs text-[var(--app-muted)]"><UiText id="common.m7ecf1cde6486" /></span> : null}
        </button>
        {isExpanded ? renderFolders(path, depth + 1) : null}
      </React.Fragment>;
    });

  return <div className="max-h-[45vh] min-h-[240px] overflow-y-auto">
    <button type="button" disabled={disabled} aria-pressed={selected === ""} onClick={() => onSelect("")}
      className={`mb-3 w-full rounded-xl px-3 py-2 text-center text-sm text-[var(--app-fg)] ${selected === "" ? "bg-[var(--panel-2)] ring-1 ring-inset ring-[var(--border)]" : "hover:bg-[var(--panel-2)]"}`}><UiText id="common.m42ee2863b6d7" />{selected === "" ? <UiText id="common.m85da02fc14ae" /> : ""}
    </button>
    {renderFolders("")}
  </div>;
}

function WorkspaceTreeLevel({
  workspace,
  parentPath,
  depth,
  activePath,
  selectedDirectory,
  expandedDirectories,
  openMenuPath,
  onToggleDirectory,
  onSelectFile,
  onOpenMenu,
  onRename,
  onDelete,
  onPin,
}: {
  workspace: RoleSkillWorkspace;
  parentPath: string;
  depth: number;
  activePath: string;
  selectedDirectory: string;
  expandedDirectories: Set<string>;
  openMenuPath: string;
  onToggleDirectory(path: string): void;
  onSelectFile(path: string): void;
  onOpenMenu(path: string): void;
  onRename(kind: "file" | "folder", path: string): void;
  onDelete(kind: "file" | "folder", path: string): void;
  onPin(path: string): void;
}) {
  const directories = directDirectories(workspace, parentPath);
  const files = directFiles(workspace, parentPath);
  return (
    <>
      {directories.map((path) => {
        const expanded = expandedDirectories.has(path);
        const menuKey = `folder:${path}`;
        return (
          <React.Fragment key={menuKey}>
            <WorkspaceTreeRow
              kind="folder"
              path={path}
              depth={depth}
              selected={selectedDirectory === path}
              expanded={expanded}
              menuOpen={openMenuPath === menuKey}
              primary={false}
              onClick={() => onToggleDirectory(path)}
              onOpenMenu={() => onOpenMenu(openMenuPath === menuKey ? "" : menuKey)}
              onRename={() => onRename("folder", path)}
              onDelete={() => onDelete("folder", path)}
            />
            {expanded ? (
              <WorkspaceTreeLevel
                workspace={workspace}
                parentPath={path}
                depth={depth + 1}
                activePath={activePath}
                selectedDirectory={selectedDirectory}
                expandedDirectories={expandedDirectories}
                openMenuPath={openMenuPath}
                onToggleDirectory={onToggleDirectory}
                onSelectFile={onSelectFile}
                onOpenMenu={onOpenMenu}
                onRename={onRename}
                onDelete={onDelete}
                onPin={onPin}
              />
            ) : null}
          </React.Fragment>
        );
      })}
      {files.map((file) => {
        const menuKey = `file:${file.path}`;
        return (
          <WorkspaceTreeRow
            key={menuKey}
            kind="file"
            path={file.path}
            depth={depth}
            selected={activePath === file.path}
            expanded={false}
            menuOpen={openMenuPath === menuKey}
            primary={workspace.primaryPath === file.path}
            onClick={() => onSelectFile(file.path)}
            onOpenMenu={() => onOpenMenu(openMenuPath === menuKey ? "" : menuKey)}
            onRename={() => onRename("file", file.path)}
            onDelete={() => onDelete("file", file.path)}
            onPin={() => onPin(file.path)}
          />
        );
      })}
    </>
  );
}

function WorkspaceTreeRow({
  kind,
  path,
  depth,
  selected,
  expanded,
  menuOpen,
  primary,
  onClick,
  onOpenMenu,
  onRename,
  onDelete,
  onPin,
}: {
  kind: "file" | "folder";
  path: string;
  depth: number;
  selected: boolean;
  expanded: boolean;
  menuOpen: boolean;
  primary: boolean;
  onClick(): void;
  onOpenMenu(): void;
  onRename(): void;
  onDelete(): void;
  onPin?: () => void;
}) {
  const { text } = useUiLocale();
  return (
    <div className="relative" data-workspace-menu>
      <div
        className={[
          "group flex h-9 items-center rounded-lg text-xs",
          selected ? "bg-[var(--panel-3)] text-[var(--app-fg)]" : "text-[var(--app-muted)] hover:bg-[var(--panel-2)] hover:text-[var(--app-fg)]",
        ].join(" ")}
        style={{ paddingLeft: `${8 + depth * 14}px` }}
      >
        <button type="button" onClick={onClick} className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
          {kind === "folder" ? (
            <>
              {expanded ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
              {expanded ? <FolderOpen className="h-4 w-4 shrink-0" /> : <Folder className="h-4 w-4 shrink-0" />}
            </>
          ) : (
            <>
              <span className="h-3.5 w-3.5 shrink-0" />
              <FileText className="h-4 w-4 shrink-0" />
            </>
          )}
          <span className="min-w-0 flex-1 truncate">{getSkillWorkspaceBaseName(path)}</span>
          {primary ? <Pin className="h-3.5 w-3.5 shrink-0 text-amber-500" /> : null}
        </button>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onOpenMenu();
          }}
          aria-label={text("createDynamic.m01b338cfa49b", { path: path })}
          className="mr-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md opacity-0 hover:bg-[var(--panel-bg)] group-hover:opacity-100 focus:opacity-100"
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
      </div>
      {menuOpen ? (
        <div className="absolute right-1 top-8 z-40 w-32 rounded-xl border border-[var(--border)] bg-[var(--panel-bg)] p-1 shadow-xl">
          {kind === "file" && !primary ? (
            <button type="button" onClick={onPin} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs hover:bg-[var(--panel-2)]">
              <Pin className="h-3.5 w-3.5" /><UiText id="common.mcfd8735f842e" /></button>
          ) : null}
          <button type="button" onClick={onRename} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs hover:bg-[var(--panel-2)]">
            <Pencil className="h-3.5 w-3.5" /><UiText id="common.m0d0cbac2eee5" /></button>
          <button type="button" onClick={onDelete} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-red-500 hover:bg-red-500/10">
            <Trash2 className="h-3.5 w-3.5" /><UiText id="common.m2f9daa828907" /></button>
        </div>
      ) : null}
    </div>
  );
}
