"use client";
import { UiText, useUiLocale } from "@/i18n/ui";


import type {
  SystemNavEntry,
  SystemSectionKey,
} from "@/components/admin/system-navigation";

type SystemNavSidebarProps = {
  entries: readonly SystemNavEntry[];
  active: SystemSectionKey;
  onSelect: (key: SystemSectionKey) => void;
  onPrefetch?: (key: SystemSectionKey) => void;
};

function NavButton({
  active,
  onClick,
  onPrefetch,
  label,
}: {
  active: boolean;
  onClick: () => void;
  onPrefetch?: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={onPrefetch}
      onFocus={onPrefetch}
      className={[
        "relative h-9 w-full overflow-hidden whitespace-nowrap rounded-lg border py-0 pl-6 pr-3 text-left text-[12px]",
        active
          ? "border-blue-500/20 bg-blue-500/6 text-blue-700 shadow-none dark:text-blue-300"
          : "border-transparent text-[var(--app-muted)] hover:bg-[var(--panel-2)] hover:text-[var(--app-fg)]",
      ].join(" ")}
    >
      {active ? (
        <span
          className="absolute left-0 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-r-full bg-blue-500"
          aria-hidden="true"
        />
      ) : null}
      {label}
    </button>
  );
}

export default function SystemNavSidebar({
  entries,
  active,
  onSelect,
  onPrefetch,
}: SystemNavSidebarProps) {
  const { text } = useUiLocale();
  const renderItems = () => (
    <>
      <div className="px-2 pb-2 pt-1">
        <div className="text-[12px] font-medium tracking-[0.08em] text-[var(--app-muted)]"><UiText id="admin.m00e39820c993" /></div>
      </div>
      {entries.map((entry) => (
        <div
          key={entry.key}
          className="border-t border-[var(--border)] pt-2 first:border-t-0 first:pt-0"
        >
          <div className="px-3 py-2 text-[12px] font-medium text-[var(--app-fg)]">
            {text(entry.label)}
          </div>
          <div className="space-y-1">
            {entry.items.map((item) => (
              <NavButton
                key={item.key}
                active={active === item.key}
                onClick={() => onSelect(item.key)}
                onPrefetch={() => onPrefetch?.(item.key)}
                label={text(item.label)}
              />
            ))}
          </div>
        </div>
      ))}
    </>
  );

  return (
    <>
      <aside
        className="hidden h-full space-y-2 overflow-auto rounded-2xl border border-[var(--border-2)] bg-[var(--panel-bg)]/92 p-4 shadow-sm lg:block lg:h-full"
        style={{
          width: "var(--system-nav-width)",
          height: "var(--system-panel-height)",
          boxSizing: "border-box",
        }}
      >
        {renderItems()}
      </aside>
      <aside className="max-h-[calc(100vh-7rem)] space-y-2 overflow-auto rounded-3xl border border-[var(--border-2)] bg-[var(--panel-bg)]/92 p-4 shadow-sm lg:hidden">
        {renderItems()}
      </aside>
    </>
  );
}
