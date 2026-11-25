"use client";
import { UiProps, useUiLocale } from "@/i18n/ui";


import * as React from "react";
import { Code2, Eye } from "lucide-react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { SKILL_MARKDOWN_EDIT_PLACEHOLDER } from "@/lib/role-skills/skill-markdown-template";

export type RoleSkillContentFormat = "preview" | "source";

export function formatRoleSkillPreviewMarkdown(content: string) {
  return content;
}

export function splitRoleSkillPreviewMarkdown(content: string) {
  const lines = formatRoleSkillPreviewMarkdown(content).split(/\r?\n/);
  const chunks: string[] = [];
  let current: string[] = [];
  let inFence = false;

  const pushCurrent = () => {
    const chunk = current.join("\n").trim();
    if (chunk) chunks.push(chunk);
    current = [];
  };

  for (const line of lines) {
    const fence = /^\s*```/.test(line);
    const heading = !inFence && /^\s{0,3}#{1,3}\s+/.test(line);
    if (heading && current.length) pushCurrent();

    current.push(line);
    if (fence) inFence = !inFence;
    if (!inFence && current.length >= 36 && !line.trim()) pushCurrent();
  }

  pushCurrent();
  return chunks.length ? chunks : [""];
}

export function RoleSkillContentFormatToggle({
  value,
  onChange,
  variant = "viewer",
}: {
  value: RoleSkillContentFormat;
  onChange(value: RoleSkillContentFormat): void;
  variant?: "viewer" | "editor";
}) {
  const { text } = useUiLocale();
  const editorVariant = variant === "editor";
  const previewLabel = editorVariant ? text("createDynamic.m13d61fea9f17") : text("createDynamic.m23ebf7c5ec24");
  const sourceLabel = editorVariant ? text("createDynamic.me6f04ffbaa42") : text("createDynamic.m7d8081dad59b");

  return (
    <UiProps ids={{"aria-label":["common.mecdf3b5c1956","common.m25f7ebbfa3b6"]}}><div
      role="group"
      aria-label={editorVariant ? "common.mecdf3b5c1956" : "common.m25f7ebbfa3b6"}
      className={[
        "inline-flex border border-[var(--border)] bg-[var(--panel-bg)]",
        editorVariant ? "rounded-lg p-0.5" : "rounded-xl p-1",
      ].join(" ")}
    >
      <FormatButton
        label={previewLabel}
        active={value === "preview"}
        onClick={() => onChange("preview")}
        icon={<Eye className="h-3.5 w-3.5" />}
        showLabel={editorVariant}
      />
      <FormatButton
        label={sourceLabel}
        active={value === "source"}
        onClick={() => onChange("source")}
        icon={<Code2 className="h-3.5 w-3.5" />}
        showLabel={editorVariant}
      />
    </div></UiProps>
  );
}

export function RoleSkillFormattedContent({
  content,
  className = "",
}: {
  content: string;
  className?: string;
}) {
  const previewContent = React.useMemo(
    () => formatRoleSkillPreviewMarkdown(content),
    [content],
  );

  return (
    <RoleSkillFormattedChunk content={previewContent} className={className} />
  );
}

export function RoleSkillFormattedChunk({
  content,
  className = "",
}: {
  content: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <Markdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={roleSkillMarkdownComponents}
      >
        {content}
      </Markdown>
    </div>
  );
}

const roleSkillMarkdownComponents: Components = {
  h1: ({ children }) => (
    <h1 className="mb-5 text-2xl font-bold leading-tight text-[var(--app-fg)]">
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2 className="mb-3 mt-7 text-xl font-bold text-[var(--app-fg)] first:mt-0">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="mb-2 mt-6 text-base font-semibold text-[var(--app-fg)] first:mt-0">
      {children}
    </h3>
  ),
  h4: ({ children }) => (
    <h4 className="mb-2 mt-5 text-sm font-semibold text-[var(--app-fg)] first:mt-0">
      {children}
    </h4>
  ),
  p: ({ children }) => (
    <p className="my-3 whitespace-pre-wrap text-[var(--app-muted)]">
      {children}
    </p>
  ),
  ul: ({ children }) => (
    <ul className="my-3 list-disc space-y-1 pl-6 text-[var(--app-muted)]">
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="my-3 list-decimal space-y-1 pl-6 text-[var(--app-muted)]">
      {children}
    </ol>
  ),
  li: ({ children }) => <li className="pl-1">{children}</li>,
  blockquote: ({ children }) => (
    <blockquote className="my-4 border-l-2 border-[var(--primary-bg)] pl-4 text-[var(--app-muted)]">
      {children}
    </blockquote>
  ),
  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-[var(--primary-bg)] underline underline-offset-4"
    >
      {children}
    </a>
  ),
  pre: ({ children }) => (
    <pre className="my-4 overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--panel-bg)] p-4 text-[13px] leading-6">
      {children}
    </pre>
  ),
  code: ({ children, className: codeClassName }) => (
    <code
      className={[
        "font-mono",
        codeClassName ||
          "rounded bg-[var(--panel-bg)] px-1.5 py-0.5 text-[13px]",
      ].join(" ")}
    >
      {children}
    </code>
  ),
  table: ({ children }) => (
    <div className="my-4 overflow-x-auto">
      <table className="min-w-full border-collapse text-left text-sm">
        {children}
      </table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border border-[var(--border)] bg-[var(--panel-bg)] px-3 py-2 font-semibold">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border border-[var(--border)] px-3 py-2 text-[var(--app-muted)]">
      {children}
    </td>
  ),
  hr: () => <hr className="my-6 border-[var(--border)]" />,
};

export function RoleSkillSourceContent({
  content,
  onChange,
  className = "",
}: {
  content: string;
  onChange?: (content: string) => void;
  className?: string;
}) {
  const sourceClassName = [
    "whitespace-pre-wrap p-5 font-mono text-[13px] leading-6 text-[var(--app-muted)] sm:p-6",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return onChange ? (
    <textarea
      value={content}
      onChange={(event) => onChange(event.target.value)}
      className={`${sourceClassName} h-full w-full resize-none bg-transparent outline-none placeholder:text-[var(--app-muted)]`}
      placeholder={SKILL_MARKDOWN_EDIT_PLACEHOLDER}
    />
  ) : (
    <pre className={`overflow-x-auto ${sourceClassName}`}>
      <code>{content}</code>
    </pre>
  );
}

function FormatButton({
  label,
  active,
  onClick,
  icon,
  showLabel = false,
}: {
  label: string;
  active: boolean;
  onClick(): void;
  icon: React.ReactNode;
  showLabel?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      title={label}
      className={[
        "flex h-8 items-center justify-center rounded-lg transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary-bg)]",
        showLabel ? "gap-1.5 px-2.5 text-xs" : "w-8",
        active
          ? "bg-[var(--panel-3)] text-[var(--app-fg)] shadow-[var(--shadow-2)]"
          : "text-[var(--app-muted)] hover:bg-[var(--panel-2)] hover:text-[var(--app-fg)]",
      ].join(" ")}
    >
      {icon}
      {showLabel ? <span>{label}</span> : null}
    </button>
  );
}
