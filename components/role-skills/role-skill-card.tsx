"use client";
import { UiText, useUiLocale } from "@/i18n/ui";


import * as React from "react";
import type { RoleSkillListItem } from "@/lib/role-skills/contracts";

export function RoleSkillCard({
  skill,
  selected = false,
  badge,
  onSelect,
  onView,
}: {
  skill: RoleSkillListItem;
  selected?: boolean;
  badge?: React.ReactNode;
  onSelect?: () => void;
  onView?: () => void;
}) {
  const { text } = useUiLocale();
  const content = (
    <>
      <div className={`relative aspect-video w-full overflow-hidden rounded-xl bg-[var(--panel-2)] ${selected ? "ring-2 ring-inset ring-[var(--primary-bg)]" : ""}`}>
        {skill.coverUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={skill.coverUrl} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center bg-gradient-to-br from-[var(--panel-2)] to-[var(--panel-bg)] text-2xl font-semibold text-[var(--app-muted)]">
            {skill.name.slice(0, 2)}
          </div>
        )}
        {badge ? <span className="absolute bottom-2 left-2 rounded-full bg-black/60 px-2 py-0.5 text-xs text-white">{badge}</span> : null}
      </div>
      <h3 title={skill.name} className="mt-2 truncate text-xs font-medium text-[var(--app-fg)]">{skill.name}</h3>
    </>
  );
  const ownerName = skill.source === "system" ? text("createDynamic.me73e38c1f65d") : skill.ownerName || "";

  return (
    <article
      className="group relative min-w-0 w-full"
    >
      {onSelect || onView ? (
        <button
          type="button"
          onClick={onSelect || onView}
          aria-pressed={onSelect ? selected : undefined}
          className="block w-full rounded-xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[color-mix(in_srgb,var(--primary-bg)_35%,transparent)]"
        >
          {content}
        </button>
      ) : (
        <div className="w-full">{content}</div>
      )}
      <div className="flex min-h-7 items-center justify-between gap-2 pt-1">
        <span title={ownerName} className="min-w-0 truncate text-[11px] text-[var(--app-muted)]">{ownerName}</span>
        {onView ? <button type="button" onClick={onView} className="shrink-0 rounded-md px-1.5 py-0.5 text-xs text-[var(--app-muted)] transition hover:bg-[var(--panel-2)] hover:text-[var(--app-fg)]"><UiText id="common.m979a332955c8" /></button> : null}
      </div>
    </article>
  );
}
