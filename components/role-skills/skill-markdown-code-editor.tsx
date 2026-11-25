"use client";
import { UiProps } from "@/i18n/ui";


import * as React from "react";
import { markdown } from "@codemirror/lang-markdown";
import { Compartment, EditorState } from "@codemirror/state";
import {
  EditorView,
  placeholder as codeMirrorPlaceholder,
} from "@codemirror/view";
import { basicSetup } from "codemirror";
import { SKILL_MARKDOWN_NEW_HINT } from "@/lib/role-skills/skill-markdown-template";

export type SkillMarkdownCodeEditorProps = {
  value: string;
  onChange(value: string): void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
};

const editableCompartment = new Compartment();

const skillMarkdownCodeTheme = EditorView.theme({
  "&": {
    height: "100%",
    backgroundColor: "transparent",
    color: "var(--app-fg)",
    fontSize: "13px",
  },
  "&.cm-focused": {
    outline: "none",
  },
  ".cm-scroller": {
    overflow: "auto",
    fontFamily:
      "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
    lineHeight: "1.5rem",
  },
  ".cm-content": {
    minHeight: "20rem",
    padding: "1rem 1.25rem",
    caretColor: "var(--primary-bg)",
  },
  ".cm-line": {
    padding: "0",
  },
  ".cm-gutters": {
    borderRight: "1px solid var(--border)",
    backgroundColor: "var(--panel-bg)",
    color: "var(--app-muted)",
  },
  ".cm-activeLine, .cm-activeLineGutter": {
    backgroundColor: "var(--panel-2)",
  },
  ".cm-selectionBackground": {
    backgroundColor: "color-mix(in srgb, var(--primary-bg) 20%, transparent)",
  },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground": {
    backgroundColor: "color-mix(in srgb, var(--primary-bg) 35%, transparent)",
  },
  ".cm-content::selection, .cm-content ::selection": {
    backgroundColor: "color-mix(in srgb, var(--primary-bg) 35%, transparent)",
    color: "var(--app-fg)",
  },
  ".cm-placeholder": {
    color: "var(--app-muted)",
    whiteSpace: "pre-wrap",
  },
  ".cm-cursor, .cm-dropCursor": {
    borderLeftColor: "var(--primary-bg)",
  },
});

export function SkillMarkdownCodeEditor({
  value,
  onChange,
  disabled = false,
  placeholder = SKILL_MARKDOWN_NEW_HINT,
  className = "",
}: SkillMarkdownCodeEditorProps) {
  const hostRef = React.useRef<HTMLDivElement>(null);
  const viewRef = React.useRef<EditorView | null>(null);
  const onChangeRef = React.useRef(onChange);
  const syncingRef = React.useRef(false);
  const initialValueRef = React.useRef(value);
  const initialDisabledRef = React.useRef(disabled);
  const initialPlaceholderRef = React.useRef(placeholder);

  React.useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  React.useEffect(() => {
    if (!hostRef.current) return;
    const view = new EditorView({
      parent: hostRef.current,
      doc: initialValueRef.current,
      extensions: [
        basicSetup,
        markdown(),
        EditorView.lineWrapping,
        codeMirrorPlaceholder(initialPlaceholderRef.current),
        editableCompartment.of([
          EditorView.editable.of(!initialDisabledRef.current),
          EditorState.readOnly.of(initialDisabledRef.current),
        ]),
        EditorView.updateListener.of((update) => {
          if (!update.docChanged || syncingRef.current) return;
          onChangeRef.current(update.state.doc.toString());
        }),
        skillMarkdownCodeTheme,
      ],
    });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  React.useEffect(() => {
    const view = viewRef.current;
    if (!view || view.state.doc.toString() === value) return;
    syncingRef.current = true;
    view.dispatch({
      changes: {
        from: 0,
        to: view.state.doc.length,
        insert: value,
      },
    });
    syncingRef.current = false;
  }, [value]);

  React.useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: editableCompartment.reconfigure([
        EditorView.editable.of(!disabled),
        EditorState.readOnly.of(disabled),
      ]),
    });
  }, [disabled]);

  return (
    <UiProps ids={{"aria-label":["common.m3575fe3e85b8"]}}><div
      ref={hostRef}
      aria-label="common.m3575fe3e85b8"
      aria-disabled={disabled || undefined}
      className={[
        "skill-markdown-code-editor h-full min-h-[20rem] overflow-hidden bg-transparent text-[var(--app-fg)]",
        disabled ? "opacity-75" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    /></UiProps>
  );
}
