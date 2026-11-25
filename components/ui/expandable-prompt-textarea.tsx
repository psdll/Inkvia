"use client";
import { UiText, UiProps } from "@/i18n/ui";


import * as React from "react";
import { createPortal } from "react-dom";
import { Maximize2, X } from "lucide-react";
import { PromptRichEditor } from "@/components/ui/prompt-rich-editor";
import { PromptEditorPortal } from "@/components/ui/prompt-editor-portal";
import type { PromptReferenceAsset } from "@/lib/prompt-asset-references";
import type { RoleSkillListItem } from "@/lib/role-skills/contracts";

type PanelRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

type PointerSession = {
  pointerId: number;
  startX: number;
  startY: number;
  rect: PanelRect;
};

export function ExpandablePromptTextarea({
  value,
  disabled,
  maxLength,
  placeholder,
  className = "",
  leadingToken,
  assets = [],
  roleSkills = [],
  roleSkillsLoading = false,
  roleSkillsError = null,
  onRoleSkillSelect,
  selectedRoleSkill = null,
  onRoleSkillRemove,
  onChange,
}: {
  value: string;
  disabled?: boolean;
  maxLength?: number;
  placeholder?: string;
  className?: string;
  leadingToken?: React.ReactNode;
  assets?: PromptReferenceAsset[];
  roleSkills?: RoleSkillListItem[];
  roleSkillsLoading?: boolean;
  roleSkillsError?: string | null;
  onRoleSkillSelect?: (skill: RoleSkillListItem) => void;
  selectedRoleSkill?: RoleSkillListItem | null;
  onRoleSkillRemove?: () => void;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [editorHost, setEditorHost] = React.useState<HTMLDivElement | null>(null);
  const [panelRect, setPanelRect] = React.useState<PanelRect | null>(null);
  const sourceRef = React.useRef<HTMLDivElement | null>(null);
  const dragRef = React.useRef<PointerSession | null>(null);
  const resizeRef = React.useRef<PointerSession | null>(null);

  const clampRect = React.useCallback((rect: PanelRect): PanelRect => {
    if (typeof window === "undefined") return rect;
    const width = Math.max(360, Math.min(rect.width, window.innerWidth - 32));
    const height = Math.max(260, Math.min(rect.height, window.innerHeight - 32));
    return {
      width,
      height,
      left: Math.max(
        16,
        Math.min(rect.left, Math.max(16, window.innerWidth - width - 16)),
      ),
      top: Math.max(
        16,
        Math.min(rect.top, Math.max(16, window.innerHeight - height - 16)),
      ),
    };
  }, []);

  const openPanel = React.useCallback(() => {
    const source = sourceRef.current?.getBoundingClientRect();
    const width = Math.min(760, window.innerWidth - 32);
    const height = Math.min(620, window.innerHeight - 32);
    setPanelRect(clampRect({
      left: source ? source.right + 24 : (window.innerWidth - width) / 2,
      top: source ? source.top - 280 : (window.innerHeight - height) / 2,
      width,
      height,
    }));
    setOpen(true);
  }, [clampRect]);

  const closePanel = React.useCallback(() => {
    dragRef.current = null;
    resizeRef.current = null;
    setOpen(false);
    setPanelRect(null);
  }, []);

  React.useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (document.querySelector("[data-role-skill-dialog]")) return;
      event.preventDefault();
      closePanel();
    };
    const handleResize = () => {
      setPanelRect((current) => current ? clampRect(current) : current);
    };
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", handleResize);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", handleResize);
    };
  }, [clampRect, closePanel, open]);

  React.useEffect(() => {
    if (!open) return;
    const handlePointerMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (drag?.pointerId === event.pointerId) {
        setPanelRect(clampRect({
          ...drag.rect,
          left: drag.rect.left + event.clientX - drag.startX,
          top: drag.rect.top + event.clientY - drag.startY,
        }));
        return;
      }
      const resize = resizeRef.current;
      if (resize?.pointerId !== event.pointerId) return;
      setPanelRect(clampRect({
        ...resize.rect,
        width: resize.rect.width + event.clientX - resize.startX,
        height: resize.rect.height + event.clientY - resize.startY,
      }));
    };
    const handlePointerUp = (event: PointerEvent) => {
      if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
      if (resizeRef.current?.pointerId === event.pointerId) resizeRef.current = null;
    };
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
    return () => {
      dragRef.current = null;
      resizeRef.current = null;
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };
  }, [clampRect, open]);

  const handleValueChange = React.useCallback((nextValue: string) => {
    onChange(maxLength && nextValue.length > maxLength
      ? nextValue.slice(0, maxLength)
      : nextValue);
  }, [maxLength, onChange]);

  const renderEditor = (expanded: boolean) => (
    <PromptRichEditor
      autoFocus={expanded}
      expanded={expanded}
      value={value}
      assets={assets}
      disabled={disabled}
      roleSkills={roleSkills}
      roleSkillsLoading={roleSkillsLoading}
      roleSkillsError={roleSkillsError}
      onRoleSkillSelect={onRoleSkillSelect}
      selectedRoleSkill={selectedRoleSkill}
      onRoleSkillRemove={onRoleSkillRemove}
      onValueChange={handleValueChange}
      placeholder={placeholder}
      leadingToken={leadingToken ? (
        <div data-expandable-prompt-leading-token="">{leadingToken}</div>
      ) : undefined}
      className={[
        "h-full min-h-0 flex-1",
        expanded ? "" : "!text-xs !leading-5",
        className,
      ].filter(Boolean).join(" ")}
      contentClassName="pr-7"
    />
  );

  const expandedPanel = open && panelRect && typeof document !== "undefined"
    ? createPortal(
        <div
          className="fixed z-[120] flex flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] text-[var(--app-fg)] shadow-[var(--shadow)]"
          style={panelRect}
        >
          <div className="flex h-11 shrink-0 items-center border-b border-[var(--border)] bg-[var(--panel-2)]">
            <div
              className="flex h-full min-w-0 flex-1 cursor-move touch-none select-none items-center gap-2 px-3"
              onPointerDown={(event) => {
                if (event.button !== 0) return;
                dragRef.current = {
                  pointerId: event.pointerId,
                  startX: event.clientX,
                  startY: event.clientY,
                  rect: panelRect,
                };
              }}
            >
              <Maximize2 className="h-4 w-4 shrink-0 text-[var(--app-muted)]" />
              <span className="truncate text-sm font-semibold"><UiText id="common.mb52f59e63937" /></span>
              <span className="shrink-0 text-xs text-[var(--app-muted)]">
                {value.length}<UiText id="common.mc55038b272b1" /></span>
            </div>
            <UiProps ids={{"aria-label":["common.m57004465b7d3"]}}><button
              type="button"
              onClick={closePanel}
              aria-label="common.m57004465b7d3"
              className="mr-2 inline-flex h-8 w-8 items-center justify-center rounded-lg text-[var(--app-muted)] transition hover:bg-[var(--panel-3)] hover:text-[var(--app-fg)]"
            >
              <X className="h-4 w-4" />
            </button></UiProps>
          </div>
          <div className="relative min-h-0 flex-1 p-3">
            <div ref={setEditorHost} className="relative h-full min-h-0" />
          </div>
          <UiProps ids={{"aria-label":["common.m58f002bafda0"],"title":["common.m6cf2895f0080"]}}><div
            role="separator"
            aria-label="common.m58f002bafda0"
            title="common.m6cf2895f0080"
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              event.preventDefault();
              event.stopPropagation();
              resizeRef.current = {
                pointerId: event.pointerId,
                startX: event.clientX,
                startY: event.clientY,
                rect: panelRect,
              };
            }}
            className="absolute bottom-1.5 right-1.5 h-5 w-5 cursor-se-resize touch-none rounded-md text-[var(--app-muted)] opacity-70 transition hover:bg-[var(--panel-3)] hover:opacity-100"
          >
            <span className="absolute bottom-1 right-1 h-2.5 w-2.5 border-b border-r border-current" />
            <span className="absolute bottom-1 right-1 h-4 w-4 border-b border-r border-current opacity-60" />
          </div></UiProps>
        </div>,
        document.body,
      )
    : null;

  return (
    <>
      <PromptEditorPortal target={editorHost}>{renderEditor(open)}</PromptEditorPortal>
      <div ref={sourceRef} className="relative flex min-h-0 flex-1 transform-gpu">
        {open ? (
          <div className="h-full w-full" aria-hidden="true" />
        ) : (
          <>
            <div ref={setEditorHost} className="h-full min-h-0 flex-1" />
            <UiProps ids={{"title":["common.maec5cc0d276f"],"aria-label":["common.maec5cc0d276f"]}}><button
              type="button"
              onClick={openPanel}
              title="common.maec5cc0d276f"
              aria-label="common.maec5cc0d276f"
              className="absolute right-0 top-0 z-10 inline-flex h-6 w-6 items-center justify-center bg-transparent text-[var(--app-muted)] transition-colors hover:text-[var(--app-fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_srgb,var(--primary-bg)_40%,transparent)]"
            >
              <span aria-hidden="true" className="block h-2.5 w-2.5 border-r border-t border-current" />
            </button></UiProps>
          </>
        )}
      </div>
      {expandedPanel}
    </>
  );
}
