"use client";
import { UiProps } from "@/i18n/ui";


import * as React from "react";
import {
  RoleSkillContentFormatToggle,
  type RoleSkillContentFormat,
} from "@/components/role-skills/role-skill-content-view";
import { SkillMarkdownCodeEditor } from "@/components/role-skills/skill-markdown-code-editor";
import { SkillMarkdownPreviewEditor } from "@/components/role-skills/skill-markdown-preview-editor";
import { SKILL_MARKDOWN_NEW_PLACEHOLDER } from "@/lib/role-skills/skill-markdown-template";

const DEFAULT_SKILL_MARKDOWN_PLACEHOLDER = SKILL_MARKDOWN_NEW_PLACEHOLDER;

export type SkillMarkdownEditorProps = {
  value: string;
  onChange(value: string): void;
  disabled?: boolean;
  allowPreview?: boolean;
  placeholder?: string;
  className?: string;
  mode?: RoleSkillContentFormat;
  onModeChange?(mode: RoleSkillContentFormat): void;
  showModeToggle?: boolean;
};

export function SkillMarkdownEditor({
  value,
  onChange,
  disabled = false,
  allowPreview = true,
  placeholder = DEFAULT_SKILL_MARKDOWN_PLACEHOLDER,
  className = "",
  mode: controlledMode,
  onModeChange,
  showModeToggle = true,
}: SkillMarkdownEditorProps) {
  const [uncontrolledMode, setUncontrolledMode] =
    React.useState<RoleSkillContentFormat>("preview");
  const mode = controlledMode ?? uncontrolledMode;
  const visibleMode = allowPreview ? mode : "source";
  const setMode = React.useCallback(
    (nextMode: RoleSkillContentFormat) => {
      if (controlledMode === undefined) setUncontrolledMode(nextMode);
      onModeChange?.(nextMode);
    },
    [controlledMode, onModeChange],
  );

  return (
    <UiProps ids={{"aria-label":["common.m99fa748655ca"]}}><section
      aria-label="common.m99fa748655ca"
      className={[
        "flex h-full min-h-[20rem] min-w-0 flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--input-bg)]",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {showModeToggle ? (
        <div className="flex shrink-0 justify-end border-b border-[var(--border)] bg-[var(--panel-bg)] px-2 py-2">
          <RoleSkillContentFormatToggle
            value={visibleMode}
            onChange={setMode}
            variant="editor"
          />
        </div>
      ) : null}

      <div className="min-h-0 flex-1">
        {visibleMode === "preview" ? (
          <SkillMarkdownPreviewEditor
            value={value}
            onChange={onChange}
            disabled={disabled}
            placeholder={placeholder}
          />
        ) : (
          <SkillMarkdownCodeEditor
            value={value}
            onChange={onChange}
            disabled={disabled}
            placeholder={placeholder}
          />
        )}
      </div>
    </section></UiProps>
  );
}
