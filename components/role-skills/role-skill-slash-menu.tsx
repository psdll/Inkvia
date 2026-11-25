"use client";
import { UiProps } from "@/i18n/ui";


import * as React from "react";
import type { SuggestionKeyDownProps, SuggestionProps } from "@tiptap/suggestion";
import { RoleSkillPicker, type RoleSkillPickerSource } from "@/components/role-skills/role-skill-picker";
import { filterRoleSkillSuggestions } from "@/hooks/use-role-skill-catalog";
import type { RoleSkillListItem } from "@/lib/role-skills/contracts";

export type RoleSkillSlashMenuHandle = {
  onKeyDown: (props: SuggestionKeyDownProps) => boolean;
};

export type RoleSkillSlashMenuProps = SuggestionProps<
  RoleSkillListItem,
  RoleSkillListItem
> & {
  catalog: RoleSkillListItem[];
  favoriteSkillIds: string[];
  loading?: boolean;
  error?: string | null;
  onOpenLibrary: (view: "browse" | "create" | "detail", skill?: RoleSkillListItem) => void;
  onDismiss: () => void;
};

export const RoleSkillSlashMenu = React.forwardRef<
  RoleSkillSlashMenuHandle,
  RoleSkillSlashMenuProps
>(function RoleSkillSlashMenu(props, ref) {
  const [source, setSource] = React.useState<RoleSkillPickerSource>("system");
  const [query, setQuery] = React.useState(props.query);
  const [activeIndex, setActiveIndex] = React.useState(0);
  const [keyboardNavigationVersion, setKeyboardNavigationVersion] = React.useState(0);
  const items = React.useMemo(() => filterRoleSkillSuggestions(
    props.catalog.filter((skill) => source === "all" || (source === "favorites"
      ? props.favoriteSkillIds.includes(skill.id)
      : skill.source === source)),
    query,
  ), [props.catalog, props.favoriteSkillIds, query, source]);

  React.useEffect(() => setQuery(props.query), [props.query]);
  React.useEffect(() => setActiveIndex(0), [query, source, items.length]);

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.isComposing || event.keyCode === 229) return false;
    if (!items.length) return false;
    if (event.key === "ArrowDown") {
      setKeyboardNavigationVersion((current) => current + 1);
      setActiveIndex((current) => (current + 1) % items.length);
      return true;
    }
    if (event.key === "ArrowUp") {
      setKeyboardNavigationVersion((current) => current + 1);
      setActiveIndex((current) => (current - 1 + items.length) % items.length);
      return true;
    }
    if (event.key === "Enter") {
      props.command(items[activeIndex % items.length]);
      return true;
    }
    return false;
  };

  React.useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => handleKeyDown(event),
  }));

  return (
    <UiProps ids={{"aria-label":["common.mbb846c69627f"]}}><div
      data-role-skill-slash-menu=""
      role="dialog"
      aria-label="common.mbb846c69627f"
      onKeyDown={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
      className="flex h-[440px] max-h-[calc(100dvh-24px)] w-[min(460px,calc(100vw-24px))] flex-col overflow-hidden rounded-2xl border border-[var(--canvas-controls-border,var(--border))] bg-[var(--canvas-task-result-placeholder-text-bg,var(--panel-bg))] p-3 text-[var(--app-fg)] shadow-[0_16px_48px_rgb(0_0_0_/_24%),0_3px_10px_rgb(0_0_0_/_12%)]"
    >
      <RoleSkillPicker
        items={items}
        loading={props.loading}
        error={props.error}
        source={source}
        onSourceChange={setSource}
        query={query}
        onQueryChange={setQuery}
        activeIndex={activeIndex}
        keyboardNavigationVersion={keyboardNavigationVersion}
        onActiveIndexChange={setActiveIndex}
        onSelect={props.command}
        onCreate={() => props.onOpenLibrary("create")}
        onBrowse={() => props.onOpenLibrary("browse")}
        onView={(skill) => props.onOpenLibrary("detail", skill)}
        onSearchKeyDown={(event) => {
          if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
          if (event.key === "Escape") {
            event.preventDefault();
            props.onDismiss();
          } else if (handleKeyDown(event.nativeEvent) || event.key === "Enter") {
            event.preventDefault();
          }
        }}
      />
    </div></UiProps>
  );
});
