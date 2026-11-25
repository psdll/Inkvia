"use client";
import { useUiLocale } from "@/i18n/ui";

import * as React from "react";
import { Markdown } from "@tiptap/markdown";
import Placeholder from "@tiptap/extension-placeholder";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";

export type SkillMarkdownPreviewEditorProps = {
  value: string;
  onChange(value: string): void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
};

export function SkillMarkdownPreviewEditor({
  value,
  onChange,
  disabled = false,
  placeholder: placeholderProp,
  className = "",
}: SkillMarkdownPreviewEditorProps) {
  const { text } = useUiLocale();
  const placeholder = placeholderProp ?? text("createDynamic.md2e1a976bfbb");
  const editorLabel = text("createDynamic.mcd672c31d29d");
  const onChangeRef = React.useRef(onChange);
  const syncingRef = React.useRef(false);

  React.useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const editor = useEditor(
    {
      extensions: [
        StarterKit,
        Markdown,
        Placeholder.configure({ placeholder }),
      ],
      content: value,
      contentType: "markdown",
      editable: !disabled,
      immediatelyRender: false,
      editorProps: {
        attributes: {
          "aria-label": editorLabel,
          class: "min-h-[20rem] px-5 py-4 outline-none",
        },
      },
      onUpdate({ editor }) {
        if (syncingRef.current) return;
        onChangeRef.current(editor.getMarkdown());
      },
    },
    [placeholder, editorLabel],
  );

  React.useEffect(() => {
    if (!editor || editor.isDestroyed || editor.getMarkdown() === value) return;
    syncingRef.current = true;
    editor.commands.setContent(value, {
      contentType: "markdown",
      emitUpdate: false,
    });
    syncingRef.current = false;
  }, [editor, value]);

  React.useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    editor.setEditable(!disabled);
  }, [disabled, editor]);

  return (
    <EditorContent
      editor={editor}
      aria-disabled={disabled || undefined}
      className={[
        "skill-markdown-preview-editor h-full overflow-y-auto bg-transparent text-sm leading-7 text-[var(--app-fg)]",
        "[&_.ProseMirror]:min-h-full [&_.ProseMirror]:cursor-text",
        "[&_.ProseMirror_h1]:mb-5 [&_.ProseMirror_h1]:text-2xl [&_.ProseMirror_h1]:font-bold [&_.ProseMirror_h1]:leading-tight",
        "[&_.ProseMirror_h2]:mb-3 [&_.ProseMirror_h2]:mt-7 [&_.ProseMirror_h2]:text-xl [&_.ProseMirror_h2]:font-bold",
        "[&_.ProseMirror_h3]:mb-2 [&_.ProseMirror_h3]:mt-6 [&_.ProseMirror_h3]:text-base [&_.ProseMirror_h3]:font-semibold",
        "[&_.ProseMirror_p]:my-3 [&_.ProseMirror_p]:whitespace-pre-wrap [&_.ProseMirror_p]:text-[var(--app-muted)]",
        "[&_.ProseMirror_ul]:my-3 [&_.ProseMirror_ul]:list-disc [&_.ProseMirror_ul]:space-y-1 [&_.ProseMirror_ul]:pl-6",
        "[&_.ProseMirror_ol]:my-3 [&_.ProseMirror_ol]:list-decimal [&_.ProseMirror_ol]:space-y-1 [&_.ProseMirror_ol]:pl-6",
        "[&_.ProseMirror_blockquote]:my-4 [&_.ProseMirror_blockquote]:border-l-2 [&_.ProseMirror_blockquote]:border-[var(--primary-bg)] [&_.ProseMirror_blockquote]:pl-4 [&_.ProseMirror_blockquote]:text-[var(--app-muted)]",
        "[&_.ProseMirror_pre]:my-4 [&_.ProseMirror_pre]:overflow-x-auto [&_.ProseMirror_pre]:rounded-xl [&_.ProseMirror_pre]:border [&_.ProseMirror_pre]:border-[var(--border)] [&_.ProseMirror_pre]:bg-[var(--panel-bg)] [&_.ProseMirror_pre]:p-4 [&_.ProseMirror_pre]:font-mono [&_.ProseMirror_pre]:text-[13px] [&_.ProseMirror_pre]:leading-6",
        "[&_.ProseMirror_code]:rounded [&_.ProseMirror_code]:bg-[var(--panel-2)] [&_.ProseMirror_code]:px-1.5 [&_.ProseMirror_code]:py-0.5 [&_.ProseMirror_code]:font-mono [&_.ProseMirror_code]:text-[13px]",
        "[&_.ProseMirror_pre_code]:bg-transparent [&_.ProseMirror_pre_code]:p-0",
        "[&_.ProseMirror_hr]:my-6 [&_.ProseMirror_hr]:border-[var(--border)]",
        "[&_.ProseMirror_a]:text-[var(--primary-bg)] [&_.ProseMirror_a]:underline [&_.ProseMirror_a]:underline-offset-4",
        "[&_.ProseMirror_p.is-editor-empty:first-child:before]:pointer-events-none [&_.ProseMirror_p.is-editor-empty:first-child:before]:float-left [&_.ProseMirror_p.is-editor-empty:first-child:before]:h-0 [&_.ProseMirror_p.is-editor-empty:first-child:before]:whitespace-pre-wrap [&_.ProseMirror_p.is-editor-empty:first-child:before]:text-[var(--app-muted)] [&_.ProseMirror_p.is-editor-empty:first-child:before]:content-[attr(data-placeholder)]",
        disabled ? "opacity-75" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    />
  );
}
