"use client";
import { UiProps } from "@/i18n/ui";


import * as React from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { CanvasAppearanceSettings } from "./CanvasAppearance";
import { CanvasArrangeMenu } from "./CanvasArrangeMenu";
import type { CanvasArrangeOptions } from "@/lib/canvas/arrangement";
import { useCanvasReadOnly } from "./CanvasReadOnlyContext";
import BrandLogo from "@/components/ui/BrandLogo";
import { useDesktopMode } from "@/components/system/desktop-mode";

function DesktopCanvasReturnButton({ beforeReturn }: { beforeReturn?: () => Promise<boolean> }) {
  const router = useRouter();
  const [returning, setReturning] = React.useState(false);

  const returnToProjects = async () => {
    if (returning) return;
    setReturning(true);
    if (beforeReturn && !(await beforeReturn())) {
      setReturning(false);
      return;
    }
    router.push("/canvas");
  };

  return <UiProps ids={{"title":["canvas.m94abed65b1bc"],"aria-label":["canvas.m94abed65b1bc"]}}><button
    type="button"
    title="canvas.m94abed65b1bc"
    aria-label="canvas.m94abed65b1bc"
    disabled={returning}
    onClick={() => void returnToProjects()}
    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md hover:bg-[var(--canvas-controls-hover)] disabled:opacity-40"
  ><ChevronLeft className="h-4 w-4" /></button></UiProps>;
}

export function CanvasTitleBar({ title, onRename, onArrange, arrangeDisabled, onBeforeReturn }: {
  title: string;
  onRename: (title: string) => void;
  onArrange?: (options: CanvasArrangeOptions) => void;
  arrangeDisabled?: boolean;
  onBeforeReturn?: () => Promise<boolean>;
}) {
  const readOnly = useCanvasReadOnly();
  const desktopMode = useDesktopMode();
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(title);
  const cancelled = React.useRef(false);

  const finishEditing = () => {
    setEditing(false);
    if (!cancelled.current && draft.trim()) onRename(draft.trim());
  };

  return (
    <div
      data-canvas-title-bar
      className="absolute left-3 top-3 z-10 flex h-10 max-w-[calc(100%-24px)] items-center gap-2.5 rounded-[14px] border-[0.5px] border-[var(--canvas-controls-border)] bg-[color-mix(in_srgb,var(--canvas-controls-bg)_65%,transparent)] px-2.5 text-[var(--canvas-controls-text)] shadow-[var(--canvas-shadow-dropdown)] backdrop-blur-md"
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      {desktopMode && <DesktopCanvasReturnButton beforeReturn={readOnly ? undefined : async () => {
        if (editing) finishEditing();
        return onBeforeReturn ? await onBeforeReturn() : true;
      }} />}
      <BrandLogo size={26} className="shrink-0" />
      <span aria-hidden="true" className="h-4 w-px shrink-0 bg-[var(--canvas-controls-border)]" />
      {editing ? (
        <UiProps ids={{"aria-label":["canvas.m395406ab55a2"]}}><input
          aria-label="canvas.m395406ab55a2"
          autoFocus
          value={draft}
          onFocus={(event) => event.currentTarget.select()}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={finishEditing}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing || event.keyCode === 229) return;
            if (event.key === "Enter") {
              event.preventDefault();
              event.currentTarget.blur();
            } else if (event.key === "Escape") {
              event.preventDefault();
              cancelled.current = true;
              event.currentTarget.blur();
            }
          }}
          className="h-7 w-40 min-w-0 rounded-md bg-transparent px-1 text-sm outline-none ring-1 ring-[var(--canvas-controls-border)]"
        /></UiProps>
      ) : (
        <UiProps ids={{"aria-label":["canvas.m1f3898bac8ac"]}}><button
          type="button"
          disabled={readOnly}
          aria-label="canvas.m1f3898bac8ac"
          title={title}
          onClick={() => {
            cancelled.current = false;
            setDraft(title);
            setEditing(true);
          }}
          className="h-7 min-w-0 max-w-[220px] truncate rounded-md px-1 text-left text-sm font-medium hover:bg-[var(--canvas-controls-hover)] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--canvas-controls-text)]"
        >
          {title}
        </button></UiProps>
      )}
      <CanvasAppearanceSettings />
      {onArrange && <CanvasArrangeMenu onArrange={onArrange} disabled={arrangeDisabled} />}
    </div>
  );
}
