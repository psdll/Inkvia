"use client";
import { UiProps, UiText, useUiLocale } from "@/i18n/ui";


import * as React from "react";
import {
  ArrowDown,
  ArrowRight,
  Check,
  ChevronDown,
  CircleHelp,
  Grid2X2,
  LayoutTemplate,
  Network,
  Shapes,
  Library,
} from "lucide-react";
import type { CanvasArrangeOptions } from "@/lib/canvas/arrangement";

export function CanvasArrangeMenu({
  onArrange,
  disabled = false,
}: {
  onArrange: (options: CanvasArrangeOptions) => void;
  disabled?: boolean;
}) {
  const { label: uiLabel } = useUiLocale();
  const [open, setOpen] = React.useState(false);
  const [section, setSection] = React.useState<"category" | "layout" | null>(
    null,
  );
  const [followConnections, setFollowConnections] = React.useState(false);
  const root = React.useRef<HTMLDivElement>(null);
  const trigger = React.useRef<HTMLButtonElement>(null);
  const panel = React.useRef<HTMLDivElement>(null);
  const id = React.useId();
  const close = () => {
    setOpen(false);
    setSection(null);
    trigger.current?.focus();
  };
  React.useEffect(() => {
    if (!open) return;
    panel.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) {
        setOpen(false);
        setSection(null);
      }
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      setSection(null);
      trigger.current?.focus();
    };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", escape, true);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("keydown", escape, true);
    };
  }, [open]);
  const run = (
    category: CanvasArrangeOptions["category"],
    layout: CanvasArrangeOptions["layout"] = "grid",
  ) => {
    if (disabled) return;
    onArrange({
      category,
      layout,
      followConnections: category === "none" && layout !== "tidy" && followConnections,
    });
    close();
  };
  const menuKeys = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    const menu = target.closest('[role="menu"]');
    if (!menu) return;
    if (
      event.key === "ArrowDown" ||
      event.key === "ArrowUp" ||
      event.key === "Home" ||
      event.key === "End"
    ) {
      event.preventDefault();
      event.stopPropagation();
      const items = [
        ...menu.querySelectorAll<HTMLButtonElement>('button[role^="menuitem"]'),
      ].filter((item) => item.closest('[role="menu"]') === menu);
      const current = items.indexOf(target as HTMLButtonElement);
      const index =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? items.length - 1
            : (current + (event.key === "ArrowDown" ? 1 : -1) + items.length) %
              items.length;
      items[index]?.focus();
    } else if (event.key === "ArrowLeft" && menu.id !== id) {
      event.preventDefault();
      event.stopPropagation();
      const parent = panel.current?.querySelector<HTMLButtonElement>(
        `[aria-controls="${menu.id}"]`,
      );
      parent?.focus();
      setSection(null);
    }
  };
  const rowClass =
    "flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-xs outline-none hover:bg-[var(--canvas-controls-hover)] focus-visible:bg-[var(--canvas-controls-hover)]";
  const surfaceClass =
    "rounded-xl border border-[var(--canvas-controls-border)] bg-[var(--canvas-controls-bg)] p-1 text-[var(--canvas-controls-text)] shadow-[var(--canvas-shadow-dropdown)]";
  const help = (text: string) => (
    <span
      title={text}
      aria-label={text}
      className="ml-auto text-[var(--canvas-controls-text-muted)]"
    >
      <CircleHelp className="h-3.5 w-3.5" />
    </span>
  );
  return (
    <div ref={root}>
      <UiProps ids={{"aria-label":["canvas.mec31121190fd"],"title":["canvas.mec31121190fd"]}}><button
        ref={trigger}
        type="button"
        aria-label="canvas.mec31121190fd"
        title="canvas.mec31121190fd"
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => {
          setOpen(!open);
          setSection(null);
        }}
        className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-[var(--canvas-controls-hover)] disabled:opacity-40"
      >
        <LayoutTemplate className="h-4 w-4" />
      </button></UiProps>
      {open && (
        <UiProps ids={{"aria-label":["canvas.mec31121190fd"]}}><div
          ref={panel}
          id={id}
          role="menu"
          aria-label="canvas.mec31121190fd"
          onKeyDown={menuKeys}
          onWheel={(event) => event.stopPropagation()}
          className={`absolute left-0 top-[48px] w-[236px] max-h-[calc(100vh-100px)] overflow-y-auto ${surfaceClass}`}
        >
          {(
            [
              ["category", "分类整理", Shapes],
              ["layout", "布局整理", Grid2X2],
            ] as const
          ).map(([key, label, Icon]) => (
            <div
              key={key}
              className="relative"
            >
              <button
                type="button"
                role="menuitem"
                aria-haspopup="menu"
                aria-expanded={section === key}
                aria-controls={`${id}-${key}`}
                onClick={() => setSection(current => current === key ? null : key)}
                onKeyDown={(event) => {
                  if (event.key !== "ArrowRight") return;
                  event.preventDefault();
                  event.stopPropagation();
                  setSection(key);
                  requestAnimationFrame(() =>
                    panel.current
                      ?.querySelector<HTMLButtonElement>(
                        `[id="${id}-${key}"] button`,
                      )
                      ?.focus(),
                  );
                }}
                className={`${rowClass} ${section === key ? "bg-[var(--canvas-controls-hover)]" : ""}`}
              >
                <Icon className="h-4 w-4" />
                <span>{uiLabel(label)}</span>
                <ChevronDown className={`ml-auto h-3.5 w-3.5 text-[var(--canvas-controls-text-muted)] ${section === key ? "rotate-180" : ""}`} />
              </button>
              {section === key && (
                <div className="py-1 pl-3">
                  <div
                    role="menu"
                    id={`${id}-${key}`}
                    aria-label={uiLabel(label)}
                    className="border-l border-[var(--canvas-controls-border)] pl-1"
                  >
                    {key === "category" ? (
                      <>
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => run("connections")}
                          className={rowClass}
                        >
                          <Network className="h-4 w-4" />
                          <span><UiText id="canvas.mea640f255433" /></span>
                          {help("有连线的节点按上下游排列，独立节点放在下方")}
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => run("media")}
                          className={rowClass}
                        >
                          <Library className="h-4 w-4" />
                          <span><UiText id="canvas.m97954f32a34a" /></span>
                          {help("按图片、视频、音频、文本分别排列，不考虑连线")}
                        </button>
                      </>
                    ) : (
                      <>
                        {(
                          [
                            ["tidy", "对齐现有布局", LayoutTemplate],
                            ["grid", "宫格重排", Grid2X2],
                            ["horizontal", "水平布局", ArrowRight],
                            ["vertical", "垂直布局", ArrowDown],
                          ] as const
                        ).map(([layout, text, LayoutIcon]) => (
                          <button
                            key={layout}
                            type="button"
                            role="menuitem"
                            onClick={() => run("none", layout)}
                            className={rowClass}
                          >
                            <LayoutIcon className="h-4 w-4" />
                            {text}
                          </button>
                        ))}
                        <div className="my-1 border-t border-[var(--canvas-controls-border)]" />
                        <button
                          type="button"
                          role="menuitemcheckbox"
                          aria-checked={followConnections}
                          onClick={() =>
                            setFollowConnections((value) => !value)
                          }
                          className={rowClass}
                        >
                          <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-[var(--canvas-controls-border)]">
                            {followConnections && <Check className="h-3 w-3" />}
                          </span>
                          <span><UiText id="canvas.m0926aaf8d52d" /></span>
                          {help("仅宫格、水平和垂直布局按连线整理；对齐现有布局始终保留原有行与顺序")}
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div></UiProps>
      )}
    </div>
  );
}
