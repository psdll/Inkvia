"use client";
import { UiProps, UiText } from "@/i18n/ui";


import * as React from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, ChevronRight, FileText, Folder, FolderOpen } from "lucide-react";
import type { RoleSkillWorkspace } from "@/lib/role-skills/contracts";
import { getSkillWorkspaceBaseName, getSkillWorkspaceParentPath } from "@/lib/role-skills/skill-workspace";

export function SkillWorkspaceFilePicker({ workspace, value, onChange }: {
  workspace: RoleSkillWorkspace;
  value: string;
  onChange(path: string): void;
}) {
  const [open, setOpen] = React.useState(false);
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set());
  const [position, setPosition] = React.useState<React.CSSProperties>({});
  const buttonRef = React.useRef<HTMLButtonElement>(null);
  const menuRef = React.useRef<HTMLDivElement>(null);
  const menuId = React.useId();
  const directories = React.useMemo(() => {
    const paths = new Set(workspace.directories);
    for (const path of [...workspace.directories, ...workspace.files.map((file) => file.path)]) {
      let parent = getSkillWorkspaceParentPath(path);
      while (parent) {
        paths.add(parent);
        parent = getSkillWorkspaceParentPath(parent);
      }
    }
    return [...paths].sort((a, b) => a.localeCompare(b, "zh-CN"));
  }, [workspace.directories, workspace.files]);

  React.useLayoutEffect(() => {
    if (!open) return;
    const update = () => {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(320, window.innerWidth - 24);
      const below = window.innerHeight - rect.bottom - 22;
      const above = rect.top - 22;
      const showAbove = below < 240 && above > below;
      setPosition({
        position: "fixed", zIndex: 200, width,
        left: Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12)),
        ...(showAbove ? { bottom: window.innerHeight - rect.top + 10 } : { top: rect.bottom + 10 }),
        maxHeight: Math.max(0, Math.min(420, showAbove ? above : below)),
      });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!buttonRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setOpen(false);
      buttonRef.current?.focus();
    };
    menuRef.current?.querySelector<HTMLButtonElement>('[aria-current="true"]')?.focus();
    document.addEventListener("pointerdown", dismiss);
    window.addEventListener("keydown", escape, true);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      window.removeEventListener("keydown", escape, true);
    };
  }, [open]);

  function toggleOpen() {
    if (!open) {
      const parents = new Set<string>();
      let parent = value ? getSkillWorkspaceParentPath(value) : "";
      while (parent) {
        parents.add(parent);
        parent = getSkillWorkspaceParentPath(parent);
      }
      setExpanded(parents);
    }
    setOpen(!open);
  }

  const rowClass = "flex min-h-10 w-full items-center gap-2 rounded-lg py-2 pr-2 text-left text-xs text-[var(--app-fg)] hover:bg-[var(--panel-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--primary-bg)]";
  function renderLevel(parent: string, depth = 0): React.ReactNode {
    return <>
      {directories.filter((path) => getSkillWorkspaceParentPath(path) === parent).map((path) => {
        const isExpanded = expanded.has(path);
        return <React.Fragment key={path}>
          <button type="button" className={rowClass} style={{ paddingLeft: 8 + depth * 18 }} title={path} aria-label={path} aria-expanded={isExpanded} onClick={() => setExpanded((current) => {
            const next = new Set(current);
            if (next.has(path)) next.delete(path); else next.add(path);
            return next;
          })}>
            {isExpanded ? <ChevronDown size={14} className="shrink-0" /> : <ChevronRight size={14} className="shrink-0" />}
            {isExpanded ? <FolderOpen size={14} className="shrink-0" /> : <Folder size={14} className="shrink-0" />}
            <span className="truncate">{getSkillWorkspaceBaseName(path)}</span>
          </button>
          {isExpanded && renderLevel(path, depth + 1)}
        </React.Fragment>;
      })}
      {workspace.files.filter((file) => getSkillWorkspaceParentPath(file.path) === parent).map((file) => <button
        key={file.path} type="button" title={file.path} aria-label={file.path} aria-current={file.path === value ? "true" : undefined}
        className={`${rowClass} ${file.path === value ? "bg-[var(--panel-2)]" : ""}`} style={{ paddingLeft: 30 + depth * 18 }}
        onClick={() => { onChange(file.path); setOpen(false); buttonRef.current?.focus(); }}
      >
        <FileText size={14} className="shrink-0" />
        <span className="min-w-0 flex-1 truncate">{getSkillWorkspaceBaseName(file.path)}</span>
        {file.path === value && <Check size={14} className="shrink-0" />}
      </button>)}
    </>;
  }

  return <>
    <UiProps ids={{"aria-label":["common.m2a8eb9215983"]}}><button ref={buttonRef} type="button" onClick={toggleOpen} aria-label="common.m2a8eb9215983" aria-expanded={open} aria-controls={open ? menuId : undefined} title={value}
      className="inline-flex h-9 max-w-[280px] items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--panel-2)] px-3 text-xs text-[var(--app-fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary-bg)]">
      <FileText size={14} className="shrink-0" /><span className="truncate">{value ? getSkillWorkspaceBaseName(value) : <UiText id="common.m822fb37dba29" />}</span>
      <ChevronDown size={14} className={`shrink-0 ${open ? "rotate-180" : ""}`} />
    </button></UiProps>
    {open && createPortal(<UiProps ids={{"aria-label":["common.m66e263d0c167"]}}><div ref={menuRef} id={menuId} role="group" aria-label="common.m66e263d0c167" style={position}
      className="overflow-auto rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] p-2 shadow-[var(--shadow)]">
      {renderLevel("")}
    </div></UiProps>, buttonRef.current?.closest('[role="dialog"]') || document.body)}
  </>;
}
