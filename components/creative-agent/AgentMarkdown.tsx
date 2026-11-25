"use client";
import { UiProps, UiText } from "@/i18n/ui";


import * as React from "react";
import ReactMarkdown from "react-markdown";
import { createPortal } from "react-dom";
import remarkGfm from "remark-gfm";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Code2,
  Copy,
  Download,
  Maximize2,
  Table2,
  WrapText,
  X,
} from "lucide-react";
import type { CreativeAgentThinking } from "@/lib/creative-agent/contracts";
import { splitNextSteps } from "@/lib/creative-agent/next-steps";
import AgentMark from "./AgentMark";
import styles from "./canvas-agent.module.css";

export type AgentThinking = CreativeAgentThinking;

// Render batches, without delaying the model's output with a typewriter animation.
function useBatchedText(text: string, streaming: boolean) {
  const [displayed, setDisplayed] = React.useState(text);
  const latest = React.useRef(text);
  const timer = React.useRef<ReturnType<typeof setTimeout>>();
  latest.current = text;
  React.useEffect(() => {
    if (!streaming) {
      clearTimeout(timer.current);
      timer.current = undefined;
      setDisplayed(text);
    } else if (!timer.current)
      timer.current = setTimeout(() => {
        timer.current = undefined;
        setDisplayed(latest.current);
      }, 50);
  }, [text, streaming]);
  // 卸载（含开发模式 StrictMode 的模拟卸载）时一并清掉标记，否则重新挂载后不会再排定刷新，流式文字会停在第一个字
  React.useEffect(() => () => { clearTimeout(timer.current); timer.current = undefined; }, []);
  return streaming ? displayed : text;
}

export function downloadAgentText(
  text: string,
  filename: string,
  type = "text/markdown;charset=utf-8",
) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function CopyButton({
  getText,
  label,
}: {
  getText: () => string;
  label: string;
}) {
  const [state, setState] = React.useState<"idle" | "copied" | "error">("idle");
  const timer = React.useRef<ReturnType<typeof setTimeout>>();
  React.useEffect(() => () => clearTimeout(timer.current), []);
  const title =
    state === "copied"
      ? "已复制"
      : state === "error"
        ? "复制失败，请选择文字手动复制"
        : label;
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(getText());
          setState("copied");
        } catch {
          setState("error");
        }
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setState("idle"), 2000);
      }}
    >
      {state === "copied" ? <Check size={14} /> : <Copy size={14} />}
      <span className={styles.srOnly} role="status">
        {state === "idle" ? "" : title}
      </span>
    </button>
  );
}

function ContentDialog({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  const ref = React.useRef<HTMLDialogElement>(null);
  const anchor = React.useRef<HTMLSpanElement>(null);
  const [container, setContainer] = React.useState<Element | null>(null);
  React.useEffect(() => {
    setContainer(
      anchor.current?.closest("[data-agent-surface]") ?? document.body,
    );
  }, []);
  React.useEffect(() => {
    if (open && !ref.current?.open) ref.current?.showModal();
    else if (!open && ref.current?.open) ref.current.close();
  }, [open, container]);
  return (
    <>
      <span ref={anchor} hidden />
      {container &&
        createPortal(
          <dialog
            ref={ref}
            className={styles.contentDialog}
            aria-label={title}
            onClose={onClose}
            onCancel={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            onWheel={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              if (event.target === event.currentTarget) onClose();
            }}
          >
            {open && (
              <>
                <header>
                  <strong>{title}</strong>
                  <UiProps ids={{"title":["common.ma78d70ea6819"],"aria-label":["common.ma78d70ea6819"]}}><button
                    type="button"
                    title="common.ma78d70ea6819"
                    aria-label="common.ma78d70ea6819"
                    onClick={onClose}
                  >
                    <X size={18} />
                  </button></UiProps>
                </header>
                <div
                  className={`${styles.contentDialogBody} ${styles.markdown}`}
                >
                  {children}
                </div>
              </>
            )}
          </dialog>,
          container,
        )}
    </>
  );
}

function CodeBlock({ children }: { children?: React.ReactNode }) {
  const [expanded, setExpanded] = React.useState(false);
  const [fullscreen, setFullscreen] = React.useState(false);
  const code = React.isValidElement<{
    children?: React.ReactNode;
    className?: string;
  }>(children)
    ? children.props
    : null;
  const text = typeof code?.children === "string" ? code.children : "";
  const language = code?.className?.replace(/^language-/, "") || "text";
  const plain = /^(text|txt|markdown|md|plaintext)$/i.test(language);
  const [wrap, setWrap] = React.useState(plain);
  const lines = text.replace(/\n$/, "").split("\n");
  const body = (
    <pre
      className={styles.numberedCode}
      data-wrap={wrap || undefined}
      tabIndex={0}
      aria-label={`${language} 内容`}
    >
      <code>
        {lines.map((line, index) => (
          <span className={styles.codeLine} key={index}>
            <span className={styles.lineNumber} aria-hidden="true">
              {index + 1}
            </span>
            <span>
              {line}
              {index < lines.length - 1 ? "\n" : ""}
            </span>
          </span>
        ))}
      </code>
    </pre>
  );
  return (
    <div className={styles.codeBlock}>
      <div
        className={styles.blockViewport}
        data-expanded={expanded || undefined}
      >
        {body}
      </div>
      <div className={styles.blockToolbar}>
        <span>
          <Code2 size={14} />
          {language}
          <small>{lines.length}<UiText id="common.m05198195b9c1" /></small>
        </span>
        <div>
          {lines.length > 12 && (
            <UiProps ids={{"aria-label":["common.m135e73154764","common.m68e134d765e3"],"title":["common.mafd4b783536b","common.m695704a261cb"]}}><button
              type="button"
              aria-label={expanded ? "common.m135e73154764" : "common.m68e134d765e3"}
              title={expanded ? "common.mafd4b783536b" : "common.m695704a261cb"}
              aria-expanded={expanded}
              data-agent-expand
              onClick={() => setExpanded((value) => !value)}
            >
              <ChevronDown
                size={14}
                style={{ transform: expanded ? "rotate(180deg)" : undefined }}
              />
            </button></UiProps>
          )}
          <UiProps ids={{"aria-label":["common.mb096842c67b2"],"title":["common.mb096842c67b2"]}}><button
            type="button"
            aria-label="common.mb096842c67b2"
            title="common.mb096842c67b2"
            aria-pressed={wrap}
            onClick={() => setWrap((value) => !value)}
          >
            <WrapText size={14} />
          </button></UiProps>
          <UiProps ids={{"label":["common.me66db67f9f6e"]}}><CopyButton getText={() => text} label="common.me66db67f9f6e" /></UiProps>
          <UiProps ids={{"aria-label":["common.m3bdeda09bb0c"],"title":["common.m11423aad226b"]}}><button
            type="button"
            aria-label="common.m3bdeda09bb0c"
            title="common.m11423aad226b"
            onClick={() => setFullscreen(true)}
          >
            <Maximize2 size={14} />
          </button></UiProps>
        </div>
      </div>
      <ContentDialog
        open={fullscreen}
        onClose={() => setFullscreen(false)}
        title={`${language} · ${lines.length} 行`}
      >
        <div className={styles.dialogToolbar}>
          <UiProps ids={{"label":["common.me66db67f9f6e"]}}><CopyButton getText={() => text} label="common.me66db67f9f6e" /></UiProps>
          <UiProps ids={{"aria-label":["common.mb096842c67b2"],"title":["common.mb096842c67b2"]}}><button
            type="button"
            aria-pressed={wrap}
            aria-label="common.mb096842c67b2"
            title="common.mb096842c67b2"
            onClick={() => setWrap((value) => !value)}
          >
            <WrapText size={14} />
          </button></UiProps>
        </div>
        {body}
      </ContentDialog>
    </div>
  );
}

function MarkdownTable({ children }: { children?: React.ReactNode }) {
  const ref = React.useRef<HTMLTableElement>(null);
  const [fullscreen, setFullscreen] = React.useState(false);
  const rows = () =>
    Array.from(ref.current?.rows ?? []).map((row) =>
      Array.from(row.cells).map((cell) => cell.textContent || ""),
    );
  return (
    <div className={styles.tableBlock}>
      <UiProps ids={{"aria-label":["common.mfe9486a3216d"]}}><div
        className={styles.tableViewport}
        tabIndex={0}
        role="region"
        aria-label="common.mfe9486a3216d"
      >
        <table ref={ref}>{children}</table>
      </div></UiProps>
      <div className={styles.blockToolbar}>
        <span>
          <Table2 size={14} /><UiText id="common.m22d9e7c54b88" /></span>
        <div>
          <UiProps ids={{"label":["common.mafd10e12a8c7"]}}><CopyButton
            getText={() =>
              rows()
                .map((row) => row.join("\t"))
                .join("\n")
            }
            label="common.mafd10e12a8c7"
          /></UiProps>
          <UiProps ids={{"title":["common.m7a70ccd15bf4"],"aria-label":["common.m647e1026efef"]}}><button
            type="button"
            title="common.m7a70ccd15bf4"
            aria-label="common.m647e1026efef"
            onClick={() =>
              downloadAgentText(
                "\uFEFF" +
                  rows()
                    .map((row) =>
                      row
                        .map((cell) => `"${cell.replace(/"/g, '""')}"`)
                        .join(","),
                    )
                    .join("\r\n"),
                "Agent-表格.csv",
                "text/csv;charset=utf-8",
              )
            }
          >
            <Download size={14} />
          </button></UiProps>
          <UiProps ids={{"title":["common.m11423aad226b"],"aria-label":["common.mf93a4b7f5242"]}}><button
            type="button"
            title="common.m11423aad226b"
            aria-label="common.mf93a4b7f5242"
            onClick={() => setFullscreen(true)}
          >
            <Maximize2 size={14} />
          </button></UiProps>
        </div>
      </div>
      <UiProps ids={{"title":["common.m22d9e7c54b88"]}}><ContentDialog
        open={fullscreen}
        onClose={() => setFullscreen(false)}
        title="common.m22d9e7c54b88"
      >
        <div className={styles.tableViewport} tabIndex={0}>
          <table>{children}</table>
        </div>
      </ContentDialog></UiProps>
    </div>
  );
}

export function MarkdownImage({
  src,
  alt,
  title,
}: {
  src?: string;
  alt?: string;
  title?: string;
}) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <button
        type="button"
        className={styles.markdownImage}
        aria-label={`放大查看：${alt || "图片"}`}
        onClick={() => setOpen(true)}
      >
        <UiProps ids={{"alt":["common.md24c10d37db0"]}}><img src={src} alt={alt || "common.md24c10d37db0"} title={title} loading="lazy" /></UiProps>
      </button>
      <UiProps ids={{"title":["common.mba8b49f3fd10"]}}><ContentDialog
        open={open}
        onClose={() => setOpen(false)}
        title={alt || "common.mba8b49f3fd10"}
      >
        <UiProps ids={{"alt":["common.md24c10d37db0"]}}><img className={styles.fullImage} src={src} alt={alt || "common.md24c10d37db0"} /></UiProps>
      </ContentDialog></UiProps>
    </>
  );
}
const markdownComponents: React.ComponentProps<
  typeof ReactMarkdown
>["components"] = {
  a: ({ children, node: _node, ...props }) => (
    <a {...props} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
  pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
  table: ({ children }) => <MarkdownTable>{children}</MarkdownTable>,
  img: ({ node: _node, ...props }) => <MarkdownImage {...props} />,
};
const plugins = [remarkGfm];
function AgentMarkdown({
  text,
  streaming = false,
  thinking,
}: {
  text: string;
  streaming?: boolean;
  thinking?: AgentThinking;
}) {
  // 收尾的 <next> 快捷选项由对话面板渲染成按钮，正文里不显示
  const displayed = splitNextSteps(useBatchedText(text, streaming)).body;
  const liveThinking = Boolean(streaming && thinking?.streaming);
  const displayedThinking = useBatchedText(
    thinking?.content || "",
    liveThinking,
  );
  const [thinkingOpen, setThinkingOpen] = React.useState(false);
  return (
    <>
      {thinking?.content && (
        <details
          className={styles.reasoning}
          open={thinkingOpen}
          onToggle={(event) => setThinkingOpen(event.currentTarget.open)}
        >
          <summary>
            <AgentMark state={liveThinking ? "thinking" : "done"} size={18} />
            <span>{liveThinking ? <UiText id="common.m781b6393f58c" /> : <UiText id="common.ma62acb184f47" />}</span>
            {typeof thinking.duration === "number" &&
              Number.isFinite(thinking.duration) && (
                <span>{thinking.duration.toFixed(1)}<UiText id="common.m00fe8dda1fd7" /></span>
              )}
            <ChevronRight size={13} className={styles.disclosure} />
          </summary>
          {thinkingOpen && (
            <div className={`${styles.toolBody} ${styles.markdown}`}>
              <ReactMarkdown
                remarkPlugins={plugins}
                components={markdownComponents}
              >
                {displayedThinking}
              </ReactMarkdown>
            </div>
          )}
        </details>
      )}
      {displayed && (
        <div
          className={styles.markdown}
          data-streaming={streaming || undefined}
        >
          <ReactMarkdown
            remarkPlugins={plugins}
            components={markdownComponents}
          >
            {displayed}
          </ReactMarkdown>
        </div>
      )}
    </>
  );
}
export default React.memo(AgentMarkdown);
