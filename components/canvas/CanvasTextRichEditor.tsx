"use client";
import { UiProps, useUiLocale } from "@/i18n/ui";


import * as React from "react";
import { useCanvasReadOnly } from "./CanvasReadOnlyContext";
import { createPortal } from "react-dom";
import { NodeToolbar, Position } from "@xyflow/react";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import Placeholder from "@tiptap/extension-placeholder";
import { Bold, Check, Copy, Italic, List, ListOrdered, Maximize2, Minus, Pilcrow, X } from "lucide-react";
import { PromptEditorPortal } from "@/components/ui/prompt-editor-portal";

const TEXT_BACKGROUND_COLORS = [
  ["默认", ""], ["红色", "#ef4444"], ["橙色", "#f59e0b"], ["黄色", "#facc15"], ["绿色", "#22c55e"],
  ["青色", "#14b8a6"], ["蓝色", "#0ea5e9"], ["紫色", "#8b5cf6"], ["品红", "#d946ef"], ["灰色", "#737373"],
] as const;

export function CanvasTextRichEditor({ value, onChange, selected, toolbarVisible = selected, title, backgroundColor, onBackgroundColorChange, onRequestEditing }: {
  onRequestEditing?: (event: React.MouseEvent) => boolean;
  value: string;
  onChange: (value: string) => void;
  selected: boolean;
  toolbarVisible?: boolean;
  title: string;
  backgroundColor?: string;
  onBackgroundColorChange?: (color: string) => void;
}) {
  const { text, label: uiLabel } = useUiLocale();
  const readOnly = useCanvasReadOnly();
  const [colorOpen, setColorOpen] = React.useState(false);
  const toolbarRef = React.useRef<HTMLDivElement>(null);
  const changeRef = React.useRef(onChange);
  changeRef.current = onChange;
  const [editing, setEditing] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = React.useState(false);
  const [copyStatus, setCopyStatus] = React.useState("");
  const [inlineHost, setInlineHost] = React.useState<HTMLDivElement | null>(null);
  const [dialogHost, setDialogHost] = React.useState<HTMLDivElement | null>(null);
  React.useEffect(() => { setColorOpen(false); }, [selected, expanded]);
  React.useEffect(() => {
    if (!colorOpen) return;
    const outside = (event: PointerEvent) => { if (!toolbarRef.current?.contains(event.target as Node)) setColorOpen(false); };
    document.addEventListener("pointerdown", outside, true);
    return () => document.removeEventListener("pointerdown", outside, true);
  }, [colorOpen]);
  const dialogRef = React.useRef<HTMLDialogElement>(null);
  const editor = useEditor({
    extensions: [StarterKit.configure({ heading: { levels: [1, 2, 3] }, link: { openOnClick: false } }), Markdown, Placeholder.configure({ placeholder: text("workspaceFollowup.m4326e652d759") })],
    content: value,
    contentType: "markdown",
    immediatelyRender: false,
    editable: false,
    editorProps: { attributes: { class: "canvas-text-rich-content", role: "textbox", "aria-label": "文本节点内容", "aria-multiline": "true" } },
    onUpdate: ({ editor }) => changeRef.current(editor.getMarkdown()),
  });
  const state = useEditorState({ editor, selector: ({ editor }) => ({
    h1: editor?.isActive("heading", { level: 1 }), h2: editor?.isActive("heading", { level: 2 }), h3: editor?.isActive("heading", { level: 3 }),
    paragraph: editor?.isActive("paragraph"), bold: editor?.isActive("bold"), italic: editor?.isActive("italic"),
    bullet: editor?.isActive("bulletList"), ordered: editor?.isActive("orderedList"),
  }) });
  React.useEffect(() => {
    if (!editor || editor.isDestroyed || editor.getMarkdown() === value) return;
    editor.commands.setContent(value, { contentType: "markdown", emitUpdate: false });
  }, [editor, value]);
  React.useEffect(() => {
    if (!expanded) return;
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, [expanded]);
  React.useEffect(() => {
    if (!editor) return;
    editor.setEditable(!readOnly && (editing || expanded), false);
    if (!editing && !expanded) return;
    const frame = requestAnimationFrame(() => editor.commands.focus(undefined, { scrollIntoView: false }));
    return () => cancelAnimationFrame(frame);
  }, [editor, editing, expanded, readOnly]);
  React.useEffect(() => { if (!selected) setEditing(false); }, [selected]);
  React.useEffect(() => {
    if (!editing || expanded) return;
    const outside = (event: PointerEvent) => {
      const target = event.target as Element;
      if (!rootRef.current?.contains(target) && !target.closest?.("[data-canvas-text-format-toolbar]")) setEditing(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [editing, expanded]);

  const button = (label: string, action: () => void, icon: React.ReactNode, active?: boolean) => (
    <button type="button" key={label} title={label} aria-label={label} aria-pressed={active}
      disabled={!editor} onMouseDown={event => event.preventDefault()} onClick={() => { setColorOpen(false); setEditing(true); editor?.setEditable(true, false); action(); }}>{icon}</button>
  );
  const separator = <span className="canvas-text-format-separator" aria-hidden="true" />;
  const toolbar = <div ref={toolbarRef} className="canvas-text-toolbar-wrap" onKeyDown={event => { if (event.key === "Escape") { setColorOpen(false); event.stopPropagation(); } }}><UiProps ids={{"aria-label":["canvas.m85048dff1de7"]}}><div className="canvas-text-format-toolbar nodrag nopan nowheel" role="toolbar" aria-label="canvas.m85048dff1de7" data-canvas-text-format-toolbar
    onPointerDown={event => event.stopPropagation()} onKeyDown={event => { if (event.key === "Escape") setColorOpen(false); event.stopPropagation(); }}>
    <UiProps ids={{"title":["canvas.m1f9efa2507ab"],"aria-label":["canvas.m1f9efa2507ab"]}}><button type="button" title="canvas.m1f9efa2507ab" aria-label="canvas.m1f9efa2507ab" aria-expanded={colorOpen} aria-haspopup="dialog" onMouseDown={event => event.preventDefault()} onClick={() => setColorOpen(open => !open)}>
      <span className="canvas-text-color-swatch" data-default={!backgroundColor || undefined} style={{ backgroundColor: backgroundColor || undefined }} />
    </button></UiProps>
    {separator}
    {button("一级标题", () => { editor?.chain().focus(undefined, { scrollIntoView: false }).toggleHeading({ level: 1 }).run(); }, "H₁", state?.h1)}
    {button("二级标题", () => { editor?.chain().focus(undefined, { scrollIntoView: false }).toggleHeading({ level: 2 }).run(); }, "H₂", state?.h2)}
    {button("三级标题", () => { editor?.chain().focus(undefined, { scrollIntoView: false }).toggleHeading({ level: 3 }).run(); }, "H₃", state?.h3)}
    {button("正文", () => { editor?.chain().focus(undefined, { scrollIntoView: false }).setParagraph().run(); }, <Pilcrow />, state?.paragraph)}
    {separator}
    {button("加粗", () => { editor?.chain().focus(undefined, { scrollIntoView: false }).toggleBold().run(); }, <Bold />, state?.bold)}
    {button("斜体", () => { editor?.chain().focus(undefined, { scrollIntoView: false }).toggleItalic().run(); }, <Italic />, state?.italic)}
    {separator}
    {button("无序列表", () => { editor?.chain().focus(undefined, { scrollIntoView: false }).toggleBulletList().run(); }, <List />, state?.bullet)}
    {button("有序列表", () => { editor?.chain().focus(undefined, { scrollIntoView: false }).toggleOrderedList().run(); }, <ListOrdered />, state?.ordered)}
    {separator}
    {button("分隔线", () => { editor?.chain().focus(undefined, { scrollIntoView: false }).setHorizontalRule().run(); }, <Minus />)}
    {separator}
    {button("复制内容", () => {
      void (async () => {
        try {
          await navigator.clipboard.writeText(editor?.getText({ blockSeparator: "\n" }) || "");
          setCopyStatus("已复制");
        } catch { setCopyStatus("复制失败，请选中文本复制"); }
      })();
    }, copyStatus === "已复制" ? <Check /> : <Copy />)}
    {button(expanded ? "收起编辑器" : "放大编辑器", () => setExpanded(open => !open), expanded ? <X /> : <Maximize2 />)}
    <span role="status" className="sr-only">{copyStatus}</span>
  </div></UiProps>
    {colorOpen && <UiProps ids={{"aria-label":["canvas.ma41b8d4df935"]}}><div className="canvas-text-color-palette nodrag nopan nowheel" role="dialog" aria-label="canvas.ma41b8d4df935" onPointerDown={event => event.stopPropagation()}>
      {TEXT_BACKGROUND_COLORS.map(([name, color]) => <button key={name} type="button" title={uiLabel(name)} aria-label={text("workspaceFollowup.m032aba27aa0e", { v0: uiLabel(name) })} aria-pressed={(backgroundColor || "") === color}
        onMouseDown={event => event.preventDefault()} onClick={() => { onBackgroundColorChange?.(color); setColorOpen(false); }}>
        <span className="canvas-text-color-swatch" data-default={!color || undefined} style={{ backgroundColor: color || undefined }} />
      </button>)}
    </div></UiProps>}
  </div>;

  return <>
    {!readOnly && toolbarVisible && !expanded && <NodeToolbar isVisible position={Position.Top} offset={34}>{toolbar}</NodeToolbar>}
    <div ref={setInlineHost} className="h-full min-h-0" />
    <PromptEditorPortal target={expanded ? dialogHost : inlineHost}>
      <div ref={rootRef} className={`canvas-text-rich-editor ${editing || expanded ? "nodrag nopan nowheel" : "canvas-text-rich-preview"}`} data-canvas-text-editing={editing || expanded}
        onKeyDown={event => { event.stopPropagation(); if (event.key === "Escape" && !event.nativeEvent.isComposing) { setEditing(false); editor?.commands.blur(); } }}
        onDoubleClick={event => {
          if (readOnly) return;
          if (!editing && !expanded && onRequestEditing && !onRequestEditing(event)) return;
          if (!onRequestEditing || editing || expanded) event.stopPropagation();
          setEditing(true);
        }}>
        <EditorContent editor={editor} className="h-full" />
      </div>
    </PromptEditorPortal>
    {expanded && createPortal(<dialog ref={dialogRef} className="canvas-text-editor-dialog" aria-label={text("workspaceFollowup.m53a8a22e619e", { v0: title })}
      onCancel={() => setExpanded(false)} onClick={event => { if (event.target === event.currentTarget) setExpanded(false); }}>
      <div className="canvas-text-editor-dialog-inner">
        <header><span>{title}</span><UiProps ids={{"aria-label":["canvas.m4b464a292f3c"]}}><button type="button" aria-label="canvas.m4b464a292f3c" onClick={() => setExpanded(false)}><X size={18} /></button></UiProps></header>
        {toolbar}
        <div ref={setDialogHost} className="min-h-0 flex-1" />
      </div>
    </dialog>, document.body)}
  </>;
}
