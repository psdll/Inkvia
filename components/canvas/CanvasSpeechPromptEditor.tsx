"use client";
import { UiText, UiProps, useUiLocale } from "@/i18n/ui";


import { useCanvasReadOnly } from "./CanvasReadOnlyContext";
import * as React from "react";
import { Node } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { Slice } from "@tiptap/pm/model";
import { CanvasTaskParameterPopover } from "./CanvasTaskParameterPopover";
import { formatSpeechPause, speechDocToText, speechTextToDoc } from "@/lib/canvas/speech-prompt";
import { getMiniMaxSpeechCapabilities, MINIMAX_SPEECH_TEXT_MAX_LENGTH } from "@/lib/minimax-speech-models";

type TokenTarget = { position: number; token: string };
const PAUSE_PRESETS = [0.25, 0.5, 1, 1.5];

export function CanvasSpeechPromptEditor({ value, model, expanded, onValueChange, onSubmit }: {
  value: string;
  model: string;
  expanded: boolean;
  onValueChange: (value: string) => void;
  onSubmit: () => void;
}) {
  const { text } = useUiLocale();
  const readOnly = useCanvasReadOnly();
  const callbacks = React.useRef({ value, model, onValueChange, onSubmit });
  callbacks.current = { value, model, onValueChange, onSubmit };
  const capabilities = getMiniMaxSpeechCapabilities(model);
  const tokenAnchor = React.useRef<HTMLElement>(null);
  const interjectionAnchor = React.useRef<HTMLButtonElement>(null);
  const [target, setTarget] = React.useState<TokenTarget | null>(null);
  const [interjectionOpen, setInterjectionOpen] = React.useState(false);
  const [custom, setCustom] = React.useState(false);
  const [seconds, setSeconds] = React.useState("0.25");
  const [error, setError] = React.useState("");
  const [limitReached, setLimitReached] = React.useState(false);

  const openToken = (element: HTMLElement, position: number, token: string) => {
    if (readOnly) return;
    (tokenAnchor as React.MutableRefObject<HTMLElement | null>).current = element;
    setTarget({ position, token });
    setInterjectionOpen(false);
    setCustom(false);
    setError("");
    if (token.startsWith("<#")) setSeconds(token.slice(2, -2));
  };
  const openTokenRef = React.useRef(openToken);
  openTokenRef.current = openToken;

  const editor = useEditor({
    immediatelyRender: false,
    editable: !readOnly,
    coreExtensionOptions: { clipboardTextSerializer: { blockSeparator: "\n" } },
    extensions: [
      StarterKit.configure({ blockquote: false, bold: false, bulletList: false, code: false, codeBlock: false, heading: false, horizontalRule: false, italic: false, link: false, listItem: false, orderedList: false, strike: false, underline: false }),
      Placeholder.configure({ placeholder: text("workspaceFollowup.m7de345667076") }),
      Node.create({
        name: "speechToken", group: "inline", inline: true, atom: true,
        addAttributes: () => ({ token: { default: "", parseHTML: (element) => element.getAttribute("data-speech-token") } }),
        parseHTML: () => [{ tag: "span[data-speech-token]" }],
        renderHTML: ({ node }) => ["span", { "data-speech-token": node.attrs.token, class: "canvas-speech-token" }, node.attrs.token],
        renderText: ({ node }) => node.attrs.token,
        addNodeView() {
          return ({ node, getPos, editor: current }) => {
            const dom = document.createElement("span");
            dom.className = "canvas-speech-token";
            dom.dataset.speechToken = node.attrs.token;
            dom.textContent = node.attrs.token;
            dom.contentEditable = "false";
            dom.tabIndex = 0;
            dom.setAttribute("role", "button");
            dom.setAttribute("aria-label", `编辑${node.attrs.token.startsWith("<#") ? "停顿" : "语气词"} ${node.attrs.token}`);
            dom.setAttribute("aria-haspopup", "menu");
            const activate = () => {
              const position = getPos();
              if (typeof position === "number") openTokenRef.current(dom, position, node.attrs.token);
            };
            dom.addEventListener("mousedown", (event) => event.preventDefault());
            dom.addEventListener("click", activate);
            dom.addEventListener("keydown", (event) => {
              if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.stopPropagation(); activate(); }
              const position = getPos();
              if (typeof position !== "number") return;
              if (event.key === "Backspace" || event.key === "Delete") {
                event.preventDefault(); event.stopPropagation();
                current.chain().focus().deleteRange({ from: position, to: position + 1 }).run();
              } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                event.preventDefault(); event.stopPropagation();
                current.chain().focus().setTextSelection(position + (event.key === "ArrowRight" ? 1 : 0)).run();
              }
            });
            return { dom, stopEvent: (event) => ["mousedown", "click", "keydown"].includes(event.type), ignoreMutation: () => true };
          };
        },
      }),
    ],
    content: speechTextToDoc(value, model),
    editorProps: {
      attributes: { class: "min-h-full outline-none", role: "textbox", "aria-label": "语音合成文本", "aria-multiline": "true" },
      handleKeyDown: (_view, event) => {
        if (!event.isComposing && (event.ctrlKey || event.metaKey) && event.key === "Enter") {
          event.preventDefault(); callbacks.current.onSubmit(); return true;
        }
        return false;
      },
      handlePaste: (view, event) => {
        const text = event.clipboardData?.getData("text/plain");
        if (text === undefined) return false;
        event.preventDefault();
        const doc = view.state.schema.nodeFromJSON(speechTextToDoc(text, callbacks.current.model));
        view.dispatch(view.state.tr.replaceSelection(new Slice(doc.content, 1, 1)).scrollIntoView());
        return true;
      },
    },
    onUpdate: ({ editor: current }) => {
      setTarget(null);
      const next = speechDocToText(current.getJSON());
      setLimitReached(next.length > MINIMAX_SPEECH_TEXT_MAX_LENGTH);
      callbacks.current.onValueChange(next);
    },
  });

  const previousModel = React.useRef(model);
  React.useEffect(() => {
    if (!editor) return;
    if (speechDocToText(editor.getJSON()) !== value || previousModel.current !== model) {
      editor.commands.setContent(speechTextToDoc(value, model), { emitUpdate: false });
      setTarget(null);
      setInterjectionOpen(false);
    }
    previousModel.current = model;
  }, [editor, model, value]);
  React.useEffect(() => { if (expanded) editor?.commands.focus(null, { scrollIntoView: false }); }, [editor, expanded]);

  const applyToken = (token: string, showMenu = false, replaceTarget = true) => {
    if (readOnly || !editor) return;
    const selectedTarget = replaceTarget ? target : null;
    const position = selectedTarget?.position ?? editor.state.selection.from;
    if (selectedTarget && editor.state.doc.nodeAt(position)?.attrs.token !== selectedTarget.token) { setTarget(null); return; }
    const range = selectedTarget ? { from: position, to: position + 1 } : editor.state.selection;
    const selectedLength = speechDocToText({ type: "doc", content: editor.state.doc.slice(range.from, range.to).content.toJSON() });
    if (speechDocToText(editor.getJSON()).length - selectedLength.length + token.length > MINIMAX_SPEECH_TEXT_MAX_LENGTH) {
      setLimitReached(true); return;
    }
    editor.chain().focus().insertContentAt({ from: range.from, to: range.to }, { type: "speechToken", attrs: { token } }).run();
    setInterjectionOpen(false);
    if (showMenu) {
      const element = editor.view.nodeDOM(position);
      if (element instanceof HTMLElement) openToken(element, position, token);
    }
  };
  const closeToken = () => setTarget(null);
  const pauseOpen = Boolean(target?.token.startsWith("<#"));
  const wordOpen = Boolean(target && !pauseOpen);

  return <>
    <div className="canvas-generator-actions canvas-speech-actions pr-8">
      {capabilities.pause && <button disabled={readOnly} type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => { setTarget(null); applyToken("<#0.25#>", true, false); }}><span aria-hidden="true">&lt;#&gt;</span><UiText id="canvas.m674dce93ba06" /></button>}
      {capabilities.interjections.length > 0 && <button ref={interjectionAnchor} disabled={readOnly} type="button" aria-expanded={interjectionOpen} aria-haspopup="menu" onMouseDown={(event) => event.preventDefault()} onClick={() => { setTarget(null); setInterjectionOpen((open) => !open); }}><span aria-hidden="true">()</span><UiText id="canvas.m9e376ea5a087" /></button>}
    </div>
    <div className={`canvas-generator-prompt-surface${expanded ? " canvas-generator-prompt-surface--expanded min-h-0 flex-1" : ""}`}>
      <div className={`prompt-rich-editor canvas-generator-prompt-viewport canvas-speech-editor nodrag nowheel ${expanded ? "text-base" : "text-sm"}`}>
        <EditorContent editor={editor} />
      </div>
    </div>
    {limitReached && <div role="status" className="canvas-speech-hint"><UiText id="canvas.m448f859b24c2" />{MINIMAX_SPEECH_TEXT_MAX_LENGTH}<UiText id="canvas.m19f469f9cdaa" /></div>}
    <CanvasTaskParameterPopover open={pauseOpen} anchorRef={tokenAnchor} onClose={closeToken} width={160} maxHeight={340} align="start" side="bottom" className="canvas-speech-pause-popover">
      <UiProps ids={{"aria-label":["canvas.m33a10b075671"]}}><div role="menu" aria-label="canvas.m33a10b075671" className="canvas-speech-pause-menu">
        {PAUSE_PRESETS.map((duration) => <button key={duration} type="button" role="menuitemradio" aria-checked={target?.token === formatSpeechPause(duration)} onClick={() => applyToken(formatSpeechPause(duration))}>{Number.isInteger(duration) ? duration.toFixed(1) : duration}s</button>)}
        <button type="button" role="menuitem" onClick={() => setCustom(true)}><UiText id="canvas.m4eafa9e925b3" /></button>
      </div></UiProps>
      {custom && <form className="canvas-speech-custom-pause" onSubmit={(event) => { event.preventDefault(); try { applyToken(formatSpeechPause(Number(seconds))); } catch (reason) { setError((reason as Error).message); } }}>
        <label><UiText id="canvas.m84b737286dd9" /><UiProps ids={{"aria-label":["canvas.m60f3b0953420"]}}><input autoFocus type="number" min="0.01" max="99.99" step="0.01" aria-label="canvas.m60f3b0953420" value={seconds} onChange={(event) => setSeconds(event.target.value)} /></UiProps></label>
        {error && <span role="alert">{error}</span>}
        <button type="submit"><UiText id="canvas.mfac2a67ad878" /></button>
      </form>}
    </CanvasTaskParameterPopover>
    <CanvasTaskParameterPopover open={interjectionOpen || wordOpen} anchorRef={wordOpen ? tokenAnchor : interjectionAnchor} onClose={() => { setInterjectionOpen(false); closeToken(); }} width={320} maxHeight={410} align="start" side={wordOpen ? "bottom" : "top"}>
      <UiProps ids={{"aria-label":["canvas.m9e376ea5a087"]}}><div className="canvas-speech-interjections" role="menu" aria-label="canvas.m9e376ea5a087">
        {capabilities.interjections.map(([label, token]) => <button key={token} type="button" role="menuitem" onClick={() => applyToken(token)}>{label} <span>{token}</span></button>)}
      </div></UiProps>
    </CanvasTaskParameterPopover>
  </>;
}
