"use client";
import { UiProps, useUiLocale } from "@/i18n/ui";


import * as React from "react";
import { useCanvasReadOnly } from "./CanvasReadOnlyContext";

export function CanvasEditableNodeName({ name, onRename }: { name: string; onRename: (name: string) => void }) {
  const { text } = useUiLocale();
  const readOnly = useCanvasReadOnly();
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(name);
  const cancelled = React.useRef(false);

  if (!editing) return <span
    role={readOnly ? undefined : "button"}
    tabIndex={readOnly ? undefined : 0}
    title={readOnly ? name : text("workspaceFollowup.m265f31190566", { v0: name })}
    className="nodrag nopan pointer-events-auto min-w-0 cursor-text truncate"
    onPointerDown={event => event.stopPropagation()}
    onClick={event => event.stopPropagation()}
    onDoubleClick={event => {
      event.stopPropagation();
      if (readOnly) return;
      cancelled.current = false;
      setDraft(name);
      setEditing(true);
    }}
    onKeyDown={event => {
      if (readOnly || (event.key !== "Enter" && event.key !== "F2")) return;
      event.preventDefault();
      event.stopPropagation();
      cancelled.current = false;
      setDraft(name);
      setEditing(true);
    }}
  >{name}</span>;

  return <UiProps ids={{"aria-label":["canvas.m452c173a0686"]}}><input
    autoFocus
    aria-label="canvas.m452c173a0686"
    value={draft}
    className="nodrag nopan nowheel pointer-events-auto min-w-0 flex-1 bg-transparent outline-none ring-1 ring-[var(--canvas-controls-border)]"
    onFocus={event => event.currentTarget.select()}
    onPointerDown={event => event.stopPropagation()}
    onClick={event => event.stopPropagation()}
    onDoubleClick={event => event.stopPropagation()}
    onChange={event => setDraft(event.target.value)}
    onBlur={() => {
      setEditing(false);
      const next = draft.trim();
      if (!readOnly && !cancelled.current && next && next !== name) onRename(next);
    }}
    onKeyDown={event => {
      event.stopPropagation();
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
  /></UiProps>;
}
