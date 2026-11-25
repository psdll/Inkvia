"use client";
import { UiText, UiProps, useUiLocale } from "@/i18n/ui";


import * as React from "react";
import { createPortal } from "react-dom";
import { Plus, Search } from "lucide-react";
import { SkillModuleIcon } from "@/components/ui/creation-icons";
import { MediaImage } from "@/components/ui/media-image";
import { warmResilientImageCandidatesBatch } from "@/components/ui/resilient-image";
import { buildMediaPreviewCandidates, normalizeMediaUrl } from "@/lib/media-url";
import type { RoleSkillListItem } from "@/lib/role-skills/contracts";

export type RoleSkillPickerSource = "all" | "system" | "favorites" | "personal";

const coverPreviewSize = { width: 568, height: 320, mode: "cover" as const };
const thumbnailSize = { width: 88, height: 88, mode: "cover" as const };
// In-memory only: a page reload resets the saved list positions.
const scrollPositions = new Map<string, number>();

function RoleSkillHoverPreview({ skill, anchor, picker }: {
  skill: RoleSkillListItem;
  anchor: HTMLElement;
  picker: HTMLElement;
}) {
  const { text } = useUiLocale();
  const previewRef = React.useRef<HTMLDivElement>(null);
  const [position, setPosition] = React.useState<{ left: number; top: number } | null>(null);
  const [loaded, setLoaded] = React.useState(false);
  const [failed, setFailed] = React.useState(false);
  const name = skill.name.replace(/^[\w.-]+\s*·\s*/, "");

  React.useLayoutEffect(() => {
    const preview = previewRef.current;
    if (!preview) return;
    const updatePosition = () => {
      const panel = picker.getBoundingClientRect();
      const row = anchor.getBoundingClientRect();
      const list = anchor.parentElement?.getBoundingClientRect();
      if (!anchor.isConnected || (list && (row.bottom <= list.top || row.top >= list.bottom))) {
        setPosition(null);
        return;
      }
      const { width, height } = preview.getBoundingClientRect();
      const left = panel.left >= width + 32 ? panel.left - width - 20 : panel.right + 20;
      setPosition({
        left: Math.max(12, Math.min(left, window.innerWidth - width - 12)),
        top: Math.max(12, Math.min(row.top + row.height / 2 - height / 2, window.innerHeight - height - 12)),
      });
    };
    updatePosition();
    const observer = new ResizeObserver(updatePosition);
    observer.observe(preview);
    observer.observe(picker);
    window.addEventListener("resize", updatePosition);
    document.addEventListener("scroll", updatePosition, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updatePosition);
      document.removeEventListener("scroll", updatePosition, true);
    };
  }, [anchor, picker, failed]);

  if (failed) return null;
  return createPortal(
    <div
      ref={previewRef}
      role="tooltip"
      aria-label={text("createDynamic.macde559dc8b1", { name: name })}
      className="pointer-events-none fixed z-[1110] w-[284px] max-w-[calc(100vw-24px)] overflow-hidden rounded-xl border border-[var(--canvas-controls-border,var(--border))] bg-[var(--canvas-task-result-placeholder-text-bg,var(--panel-bg))] text-left text-[var(--canvas-controls-text,var(--app-fg))] shadow-2xl"
      style={{ left: position?.left ?? 0, top: position?.top ?? 0, visibility: position ? "visible" : "hidden", fontFamily: 'Arial, "PingFang SC", "Microsoft YaHei", sans-serif' }}
    >
      <div className="relative aspect-video w-full overflow-hidden bg-[var(--panel-2)]">
        <MediaImage
          src={skill.coverUrl!}
          alt={name}
          previewSize={coverPreviewSize}
          loading="eager"
          fetchPriority="high"
          cacheInMemory
          className="h-full w-full object-cover"
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
        />
        {!loaded && <div className="absolute inset-0 flex items-center justify-center text-xs text-[var(--canvas-controls-text-muted,var(--app-muted))]"><UiText id="common.mf6efa5e40542" /></div>}
      </div>
      <div className="p-4">
        <div className="line-clamp-2 break-words text-sm font-medium leading-5">{name}</div>
        {skill.summary && <p className="mt-1 line-clamp-3 break-words text-xs leading-5 text-[var(--canvas-controls-text-muted,var(--app-muted))]">{skill.summary}</p>}
      </div>
    </div>,
    document.body,
  );
}

export function RoleSkillPicker({
  items,
  loading,
  error,
  source,
  onSourceChange,
  query,
  onQueryChange,
  activeIndex,
  onActiveIndexChange,
  onSelect,
  onCreate,
  onBrowse,
  onView,
  onSearchKeyDown,
  listId,
  scrollMemoryKey,
  keyboardNavigationVersion = 0,
}: {
  items: RoleSkillListItem[];
  loading?: boolean;
  error?: string | null;
  source: RoleSkillPickerSource;
  onSourceChange: (source: RoleSkillPickerSource) => void;
  query: string;
  onQueryChange: (query: string) => void;
  activeIndex: number;
  onActiveIndexChange: (index: number) => void;
  onSelect: (skill: RoleSkillListItem) => void;
  onCreate: () => void;
  onBrowse: () => void;
  onView: (skill: RoleSkillListItem) => void;
  onSearchKeyDown?: React.KeyboardEventHandler<HTMLInputElement>;
  listId?: string;
  scrollMemoryKey?: string;
  keyboardNavigationVersion?: number;
}) {
  const { text, error: localizeError } = useUiLocale();
  const generatedId = React.useId();
  const optionsId = listId || generatedId;
  const pickerRef = React.useRef<HTMLDivElement>(null);
  const listRef = React.useRef<HTMLDivElement>(null);
  const lastKeyboardNavigation = React.useRef(keyboardNavigationVersion);
  const scrollKey = scrollMemoryKey ? JSON.stringify([scrollMemoryKey, source, query]) : null;
  const [hovered, setHovered] = React.useState<{ id: string; anchor: HTMLElement } | null>(null);
  const hoveredSkill = items.find((skill) => skill.id === hovered?.id && normalizeMediaUrl(skill.coverUrl));
  const optionRefs = React.useRef<Array<HTMLButtonElement | null>>([]);
  const itemIds = items.map((skill) => skill.id).join(",");
  // Keep prefetch stable while the active row changes; use the same candidates as the preview.
  const previewUrls = JSON.stringify([...new Set(items.map((skill) => normalizeMediaUrl(skill.coverUrl)).filter(Boolean))].slice(0, 16));
  React.useEffect(() => {
    const urls: string[] = JSON.parse(previewUrls);
    return warmResilientImageCandidatesBatch(urls.map((url) => buildMediaPreviewCandidates(url, coverPreviewSize)), { limit: 16, batchSize: 3 });
  }, [previewUrls]);
  React.useEffect(() => setHovered(null), [query, source, itemIds]);
  React.useLayoutEffect(() => {
    if (!loading && listRef.current) {
      listRef.current.scrollTop = scrollKey ? scrollPositions.get(scrollKey) ?? 0 : 0;
    }
  }, [scrollKey, source, query, loading, itemIds]);
  React.useLayoutEffect(() => {
    if (lastKeyboardNavigation.current === keyboardNavigationVersion) return;
    lastKeyboardNavigation.current = keyboardNavigationVersion;
    optionRefs.current[activeIndex]?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, keyboardNavigationVersion]);

  const muted = "text-[var(--canvas-controls-text-muted,var(--app-muted))]";
  const actionClass = "inline-flex h-7 items-center justify-center gap-1 rounded-lg px-2.5 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--app-muted)]";
  const sourceTabs = [
    { value: "all", label: text("createDynamic.m5c55a67935af") },
    { value: "system", label: text("createDynamic.m835b700e028c") },
    { value: "favorites", label: text("createDynamic.m60a53514eb92") },
    { value: "personal", label: text("createDynamic.m7f1d9dd04cd1") },
  ] as const;
  return (
    <div ref={pickerRef} onMouseLeave={() => setHovered(null)} className="flex min-h-0 flex-1 flex-col text-left text-[13px] font-normal leading-5 text-[var(--canvas-controls-text,var(--app-fg))] [&_button]:cursor-pointer" style={{ fontFamily: 'Arial, "PingFang SC", "Microsoft YaHei", sans-serif' }}>
      <div className="flex shrink-0 items-center justify-between gap-2 px-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[color-mix(in_srgb,var(--primary-bg)_16%,transparent)] text-[var(--primary-bg)]">
            <SkillModuleIcon className="h-3.5 w-3.5" />
          </span>
          <span className="text-sm font-semibold">Skill</span>
          {!loading && items.length > 0 ? <span className={`rounded-full bg-[var(--canvas-controls-hover,var(--panel-2))] px-1.5 text-[11px] leading-[18px] ${muted}`}>{items.length}</span> : null}
        </div>
        <div className="flex items-center gap-1.5">
          <button type="button" className={`${actionClass} ${muted} hover:bg-[var(--canvas-controls-hover,var(--panel-2))] hover:text-[var(--canvas-controls-text,var(--app-fg))]`} onMouseDown={(event) => { event.preventDefault(); event.stopPropagation(); }} onClick={(event) => { event.stopPropagation(); onBrowse(); }}><UiText id="common.m5c55a67935af" /></button>
          <UiProps ids={{"aria-label":["common.m04bcc5bd9b5e"]}}><button type="button" aria-label="common.m04bcc5bd9b5e" className={`${actionClass} bg-[var(--canvas-controls-text,var(--app-fg))] text-[var(--canvas-task-result-placeholder-text-bg,var(--panel-bg))] hover:opacity-90`} onMouseDown={(event) => { event.preventDefault(); event.stopPropagation(); }} onClick={(event) => { event.stopPropagation(); onCreate(); }}>
            <Plus size={13} strokeWidth={2} /><UiText id="common.mcde2cd071d25" /></button></UiProps>
        </div>
      </div>
      <label className={`mt-3 flex h-9 shrink-0 items-center gap-2 rounded-xl border border-[var(--canvas-controls-border,var(--border))] bg-[var(--canvas-controls-bg,var(--input-bg))] px-3 ${muted} transition focus-within:border-[color-mix(in_srgb,var(--primary-bg)_60%,transparent)]`}>
        <Search size={15} strokeWidth={1.6} className="shrink-0" />
        <UiProps ids={{"aria-label":["common.m43b9d66b88a8"],"placeholder":["common.madb3dcb1d5e3"]}}><input
          aria-label="common.m43b9d66b88a8"
          aria-controls={optionsId}
          placeholder="common.madb3dcb1d5e3"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={onSearchKeyDown}
          className="w-full min-w-0 border-0 bg-transparent p-0 text-[13px] text-[var(--canvas-controls-text,var(--app-fg))] outline-none placeholder:text-[var(--canvas-controls-text-muted,var(--app-muted))]"
        /></UiProps>
      </label>
      <UiProps ids={{"aria-label":["common.m63443790ce09"]}}><div role="group" aria-label="common.m63443790ce09" className="mb-2 mt-2.5 grid shrink-0 grid-cols-4 gap-1 rounded-xl bg-[var(--canvas-controls-hover,var(--panel-2))] p-1">
        {sourceTabs.map((tab) => (
          <button
            type="button"
            key={tab.value}
            aria-pressed={source === tab.value}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onSourceChange(tab.value)}
            className={`h-7 rounded-lg border-0 text-xs transition focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--app-muted)] ${source === tab.value ? "bg-[var(--canvas-task-result-placeholder-text-bg,var(--panel-bg))] font-medium text-[var(--canvas-controls-text,var(--app-fg))] shadow-[0_1px_3px_rgb(0_0_0_/_18%)]" : `bg-transparent ${muted} hover:text-[var(--canvas-controls-text,var(--app-fg))]`}`}
          >{tab.label}</button>
        ))}
      </div></UiProps>
      <UiProps ids={{"aria-label":["common.mea7e00c27290"]}}><div ref={listRef} id={optionsId} role="listbox" aria-label="common.mea7e00c27290" className="-mx-0.5 flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto overscroll-contain px-0.5"
        onScroll={(event) => {
          if (scrollKey && !loading) scrollPositions.set(scrollKey, event.currentTarget.scrollTop);
        }}
      >
        {items.length ? items.map((skill, index) => {
          const name = skill.name.replace(/^[\w.-]+\s*·\s*/, "");
          const active = index === activeIndex;
          const cover = normalizeMediaUrl(skill.coverUrl);
          return (
            <div key={skill.id} onMouseEnter={(event) => {
              onActiveIndexChange(index);
              setHovered(cover ? { id: skill.id, anchor: event.currentTarget } : null);
            }} onMouseLeave={() => setHovered(null)} className={`group relative flex items-center gap-2 rounded-xl px-2 transition-colors focus-within:bg-[var(--canvas-controls-hover,var(--panel-2))] ${active ? "bg-[var(--canvas-controls-hover,var(--panel-2))]" : "hover:bg-[var(--canvas-controls-hover,var(--panel-2))]"}`}>
              {active ? <span aria-hidden="true" className="absolute left-0 top-1/2 h-6 w-[3px] -translate-y-1/2 rounded-full bg-[var(--primary-bg)]" /> : null}
              <button
                ref={(element) => { optionRefs.current[index] = element; }}
                type="button"
                role="option"
                aria-selected={active}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onSelect(skill)}
                className="flex min-h-[64px] min-w-0 flex-1 items-center gap-3 rounded-xl border-0 bg-transparent py-2.5 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--app-muted)]"
              >
                <span className={`flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-[10px] border border-[var(--canvas-controls-border,var(--border))] bg-[var(--panel-2)] ${muted}`}>
                  {cover ? (
                    <MediaImage src={cover} alt="" previewSize={thumbnailSize} className="h-full w-full object-cover" fallback={<SkillModuleIcon className="h-4 w-4" />} />
                  ) : (
                    <SkillModuleIcon className="h-[18px] w-[18px]" />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate text-[13px] font-medium" title={name}>{name}</span>
                    {skill.category ? <span className={`shrink-0 rounded-md border border-[var(--canvas-controls-border,var(--border))] px-1.5 text-[10px] leading-4 ${muted}`}>{skill.category}</span> : null}
                  </span>
                  <span className={`mt-0.5 line-clamp-1 break-all text-xs ${muted}`} title={skill.summary}>{skill.summary}</span>
                </span>
              </button>
              <button type="button" aria-label={text("createDynamic.mea14be5b7acc", { name: name })} onMouseDown={(event) => event.preventDefault()} onClick={() => onView(skill)} className={`shrink-0 rounded-lg border border-transparent px-2 py-1 text-xs transition hover:border-[var(--canvas-controls-border,var(--border))] hover:text-[var(--canvas-controls-text,var(--app-fg))] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--app-muted)] ${active ? "text-[var(--canvas-controls-text,var(--app-fg))]" : muted}`}><UiText id="common.m979a332955c8" /></button>
            </div>
          );
        }) : (
          <div role={error ? "alert" : "status"} className="flex flex-1 flex-col items-center justify-center gap-2 px-3 py-9 text-center">
            <span className={`flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--canvas-controls-hover,var(--panel-2))] ${muted}`}>
              <SkillModuleIcon className="h-5 w-5" />
            </span>
            <p className={`text-xs ${error ? "text-red-500" : muted}`}>
              {loading ? <UiText id="common.ma55be937c92f" /> : error ? localizeError(error) : (query ? <UiText id="common.m578e81dc489c" /> : source === "favorites" ? <UiText id="common.m5a46bf1fa833" /> : source === "personal" ? <UiText id="common.mee35fd774d38" /> : source === "all" ? <UiText id="common.mbfa06e4c4e90" /> : <UiText id="common.m1b6ad3db5477" />)}
            </p>
          </div>
        )}
      </div></UiProps>
      {hoveredSkill && hovered && pickerRef.current && <RoleSkillHoverPreview key={`${hoveredSkill.id}:${hoveredSkill.coverUrl}`} skill={hoveredSkill} anchor={hovered.anchor} picker={pickerRef.current} />}
    </div>
  );
}
