"use client";
import { UiProps, UiText } from "@/i18n/ui";


import { SkillModuleIcon } from "@/components/ui/creation-icons";

export function RoleSkillTrigger({
  onClick,
  disabled = false,
  selected = false,
}: {
  onClick(): void;
  disabled?: boolean;
  selected?: boolean;
}) {
  return (
    <UiProps ids={{"title":["common.m3b0ab1fbf166"]}}><button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={selected}
      title="common.m3b0ab1fbf166"
      className={[
        "inline-flex h-6 shrink-0 items-center gap-1 border-0 bg-transparent p-0 text-xs font-medium normal-case tracking-normal transition-colors hover:text-[var(--primary-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_srgb,var(--primary-bg)_35%,transparent)] disabled:cursor-not-allowed disabled:opacity-45",
        selected ? "text-[var(--primary-bg)]" : "text-[var(--app-fg)]",
      ].join(" ")}
    >
      <SkillModuleIcon className="h-4 w-4 shrink-0" /><UiText id="common.m99aea2f9131a" /></button></UiProps>
  );
}
