"use client";
import { useUiLocale } from "@/i18n/ui";

import * as React from "react";

export function DateGroupCheckbox({ date, ids, selected, onChange, disabled = false }: {
  date: string;
  ids: number[];
  selected: Set<number>;
  onChange: React.Dispatch<React.SetStateAction<Set<number>>>;
  disabled?: boolean;
}) {
  const { text } = useUiLocale();
  const count = ids.filter(id => selected.has(id)).length;
  return <input
    type="checkbox"
    aria-label={text("createDynamic.mb11e6e557af3", { date: date })}
    aria-checked={count > 0 && count < ids.length ? "mixed" : count === ids.length && ids.length > 0}
    ref={element => { if (element) element.indeterminate = count > 0 && count < ids.length; }}
    checked={ids.length > 0 && count === ids.length}
    disabled={disabled || !ids.length}
    className="mr-2 h-4 w-4 shrink-0 align-middle accent-[var(--app-fg)]"
    onChange={event => {
      const checked = event.target.checked;
      onChange(current => {
        const next = new Set(current);
        for (const id of ids) { if (checked) next.add(id); else next.delete(id); }
        return next;
      });
    }}
  />;
}
