"use client";
import { UiText, useUiLocale } from "@/i18n/ui";


import * as React from "react";
import Link from "next/link";
import { MediaAssetsDrawer } from "@/components/ui/media-assets-drawer";
import { MediaLibraryPanel } from "@/components/media-library/media-library-panel";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { MEDIA_LIBRARY_EVENT_CLOSE, MEDIA_LIBRARY_EVENT_OPEN, MEDIA_LIBRARY_EVENT_TOGGLE } from "@/lib/media-library-events";

export type ToolShellTab = {
  key?: string;
  href?: string;
  onSelect?: () => void;
  label: string;
  icon?: React.ReactNode;
};

export type ToolShellProps = {
  tabs: ToolShellTab[];
  activeHref?: string;
  activeKey?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  historyTitle?: string;
  history?: React.ReactNode;
  onClearHistory?: () => void;
  historyActions?: React.ReactNode;
  historyError?: React.ReactNode;
};

export function ToolShell({
  tabs,
  activeHref,
  activeKey,
  children,
  footer,
  historyTitle = "创作历史 (History)",
  history,
  onClearHistory,
  historyActions,
  historyError
}: ToolShellProps) {
  const { text } = useUiLocale();
  const [historyOpen, setHistoryOpen] = React.useState(false);
  const [assetsOpen, setAssetsOpen] = React.useState(false);
  const [mediaLibraryOpen, setMediaLibraryOpen] = React.useState(false);
  const [toolboxCollapsed, setToolboxCollapsed] = React.useState(false);
  const toolboxId = React.useId();
  const toolboxToggleLabel = text(toolboxCollapsed ? "studio.m159f1051ab1d" : "studio.me43de189ca2d");
  const closeHistory = () => setHistoryOpen(false);
  const closeAssets = () => setAssetsOpen(false);

  React.useEffect(() => {
    const onToggle = () => {
      setAssetsOpen(false);
      setMediaLibraryOpen((prev) => !prev);
    };
    const onOpen = () => {
      setAssetsOpen(false);
      setMediaLibraryOpen(true);
    };
    const onClose = () => setMediaLibraryOpen(false);
    window.addEventListener(MEDIA_LIBRARY_EVENT_TOGGLE, onToggle);
    window.addEventListener(MEDIA_LIBRARY_EVENT_OPEN, onOpen);
    window.addEventListener(MEDIA_LIBRARY_EVENT_CLOSE, onClose);
    return () => {
      window.removeEventListener(MEDIA_LIBRARY_EVENT_TOGGLE, onToggle);
      window.removeEventListener(MEDIA_LIBRARY_EVENT_OPEN, onOpen);
      window.removeEventListener(MEDIA_LIBRARY_EVENT_CLOSE, onClose);
    };
  }, []);

  const historyBody = (
    <div className="h-full min-h-0 relative">
      <div className="h-full">
        {history ? (
          history
        ) : (
          <div className="h-full flex flex-col items-center justify-center space-y-4 text-zinc-500">
            <div className="w-16 h-16 bg-zinc-900 rounded-2xl flex items-center justify-center border border-zinc-800 border-dashed" />
            <p className="text-sm"><UiText id="sidebar.me362185bd2b0" /></p>
            <p className="text-xs opacity-50 text-center px-8"><UiText id="sidebar.mb2b111cf79e1" /></p>
          </div>
        )}
      </div>
      {historyError ? (
        <div className="absolute inset-0 flex items-center justify-center p-5 bg-black/10">
          {typeof historyError === "string" ? (
            <div className="w-full max-w-[520px] rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-center text-sm text-red-300">
              {historyError}
            </div>
          ) : (
            <div className="w-full max-w-[620px]">{historyError}</div>
          )}
        </div>
      ) : null}
    </div>
  );

  return (
    <div className="relative flex-1 min-h-0 overflow-hidden p-[clamp(12px,2dvh,20px)]">
      <div
        className={[
          "relative h-full w-full grid grid-cols-1 gap-[clamp(12px,2dvh,24px)] items-stretch",
          toolboxCollapsed ? "lg:grid-cols-1" : "lg:grid-cols-[minmax(440px,500px)_minmax(420px,1fr)]"
        ].join(" ")}
      >
        <button
          type="button"
          onClick={() => setToolboxCollapsed((v) => !v)}
          className={[
            "hidden lg:inline-flex absolute col-start-1 col-end-2 top-1/2 -translate-y-1/2 z-30 h-6 w-6 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--panel-bg)] text-[var(--app-muted)] hover:bg-[var(--panel-2)] hover:text-[var(--app-fg)] transition-colors",
            toolboxCollapsed ? "left-0 -translate-x-1/2" : "right-0 translate-x-1/2"
          ].join(" ")}
          aria-controls={toolboxId}
          aria-expanded={!toolboxCollapsed}
          aria-label={toolboxToggleLabel}
          title={toolboxToggleLabel}
        >
          {toolboxCollapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
        </button>
        <section
          id={toolboxId}
          className={[
            "relative rounded-[28px] border border-[var(--border)] bg-[var(--panel-bg)] text-[var(--app-fg)] shadow-[var(--shadow)] overflow-visible flex flex-col min-h-0",
            toolboxCollapsed ? "lg:hidden" : ""
          ].join(" ")}
        >
          <div className="p-[clamp(12px,1.8dvh,16px)] border-b border-[var(--border)]">
            <div className="flex items-center gap-3">
              <div className="flex-1 min-w-0 rounded-2xl border border-[var(--border)] bg-[var(--input-bg)] shadow-[var(--shadow-2)] p-1.5 flex items-center gap-2">
                {tabs.map((t) => {
                  const tabKey = t.key || t.href || t.label;
                  const active = activeKey ? tabKey === activeKey : (t.href || "") === (activeHref || "");
                  return (
                    t.onSelect ? (
                      <button
                        key={tabKey}
                        type="button"
                        onClick={t.onSelect}
                        className={[
                          "flex-1 h-10 rounded-xl flex items-center justify-center gap-2 text-sm font-medium transition-all duration-300",
                          active
                            ? "bg-[var(--panel-3)] text-[var(--app-fg)] border border-[var(--border-2)]"
                            : "text-[var(--app-muted)] hover:text-[var(--app-fg)] hover:bg-[var(--panel-2)]"
                        ].join(" ")}
                      >
                        {t.icon ? <span className={active ? "opacity-100" : "opacity-70"}>{t.icon}</span> : null}
                        <span className="truncate">{t.label}</span>
                      </button>
                    ) : (
                      <Link
                        key={tabKey}
                        href={t.href || "#"}
                        className={[
                          "flex-1 h-10 rounded-xl flex items-center justify-center gap-2 text-sm font-medium transition-all duration-300",
                          active
                            ? "bg-[var(--panel-3)] text-[var(--app-fg)] border border-[var(--border-2)]"
                            : "text-[var(--app-muted)] hover:text-[var(--app-fg)] hover:bg-[var(--panel-2)]"
                        ].join(" ")}
                      >
                        {t.icon ? <span className={active ? "opacity-100" : "opacity-70"}>{t.icon}</span> : null}
                        <span className="truncate">{t.label}</span>
                      </Link>
                    )
                  );
                })}
              </div>

              <button
                type="button"
                onClick={() => setHistoryOpen(true)}
                className="lg:hidden h-10 px-4 rounded-xl border border-[var(--border)] bg-[var(--panel-2)] text-sm text-[var(--app-muted)] hover:bg-[var(--panel-3)] hover:text-[var(--app-fg)] transition-colors"
              ><UiText id="sidebar.m2ce4a863ba2a" /></button>
            </div>
          </div>

          <div className="flex-1 min-h-0 flex flex-col">
            <div className="flex-1 min-h-0 overflow-y-auto p-[clamp(14px,2.2dvh,20px)]">
              <div className="h-full flex flex-col">{children}</div>
            </div>
            {footer ? <div className="relative z-20 p-[clamp(14px,2.2dvh,20px)] border-t border-[var(--border)] bg-[var(--panel-bg)]">{footer}</div> : null}
          </div>
        </section>

        <aside className="hidden lg:flex relative rounded-[28px] border border-[var(--border)] bg-[var(--panel-bg)] text-[var(--app-fg)] shadow-[var(--shadow)] overflow-hidden flex-col min-h-0">
          <div className="p-[clamp(14px,2.2dvh,20px)] h-[64px] border-b border-[var(--border)] flex items-center justify-between">
            <div />
            <div className="flex items-center gap-2">
              {historyActions ? <div className="flex items-center gap-2">{historyActions}</div> : null}
              <button
                type="button"
                onClick={() => setAssetsOpen(true)}
                className="h-9 px-3 text-sm font-medium text-[var(--app-fg)] rounded-xl hover:bg-[var(--panel-3)] transition-colors border border-[var(--border)] bg-[var(--panel-2)]"
              ><UiText id="sidebar.m5f45bb826b16" /></button>
              {onClearHistory ? (
                <button
                  type="button"
                  onClick={onClearHistory}
                  className="h-9 px-3 text-sm font-medium text-[var(--app-fg)] rounded-xl hover:bg-[var(--panel-3)] transition-colors border border-[var(--border)] bg-[var(--panel-2)]"
                ><UiText id="sidebar.m1ef3de06b32e" /></button>
              ) : null}
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-[clamp(14px,2.2dvh,20px)] min-h-0">{historyBody}</div>
          <MediaLibraryPanel open={mediaLibraryOpen} onClose={() => setMediaLibraryOpen(false)} />
        </aside>
      </div>

      {historyOpen ? (
        <div className="lg:hidden fixed inset-0 z-50">
          <div className="absolute inset-0 bg-[var(--overlay)]" onClick={closeHistory} />
          <div className="absolute right-0 top-0 h-full w-[360px] bg-[var(--panel-bg)] border-l border-[var(--border)] flex flex-col shadow-[var(--shadow)]">
            <div className="p-[clamp(12px,1.8dvh,16px)] h-[60px] border-b border-[var(--border)] flex items-center justify-between">
              <div />
              <div className="flex items-center gap-2">
                {historyActions ? <div className="flex items-center gap-2">{historyActions}</div> : null}
                <button
                  type="button"
                  onClick={() => setAssetsOpen(true)}
                  className="h-8 px-3 text-xs text-[var(--app-muted)] rounded-xl hover:bg-[var(--panel-2)] hover:text-[var(--app-fg)] transition-colors border border-[var(--border)] bg-[var(--panel-2)]"
                ><UiText id="sidebar.m5f45bb826b16" /></button>
                {onClearHistory ? (
                  <button
                    type="button"
                    onClick={onClearHistory}
                    className="h-8 px-3 text-xs text-[var(--app-muted)] rounded-xl hover:bg-[var(--panel-2)] hover:text-[var(--app-fg)] transition-colors border border-[var(--border)] bg-[var(--panel-2)]"
                  ><UiText id="sidebar.m1ef3de06b32e" /></button>
                ) : null}
                <button
                  type="button"
                  onClick={closeHistory}
                  className="h-8 px-3 text-xs text-[var(--app-muted)] rounded-xl hover:bg-[var(--panel-2)] hover:text-[var(--app-fg)] transition-colors border border-[var(--border)] bg-[var(--panel-2)]"
                ><UiText id="sidebar.m3fd47edce45b" /></button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-[clamp(12px,1.8dvh,16px)] min-h-0">{historyBody}</div>
          </div>
        </div>
      ) : null}

      <MediaAssetsDrawer open={assetsOpen} onClose={closeAssets} />
    </div>
  );
}
