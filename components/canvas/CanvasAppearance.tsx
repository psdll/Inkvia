"use client";
import { UiText, UiProps, useUiLocale } from "@/i18n/ui";


import * as React from "react";
import { Check, Settings2, X } from "lucide-react";
import { CanvasColorPopover } from "./CanvasColorPopover";

type Appearance = {
  pattern: "dots" | "grid" | "solid";
  background: string;
  highlight: string;
};
const defaults: Appearance = { pattern: "dots", background: "", highlight: "" };
const Context = React.createContext({
  value: defaults,
  update: (_patch: Partial<Appearance>) => {},
});
export const useCanvasAppearance = () => React.useContext(Context);
const isColor = (value: unknown): value is string =>
  typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);

export function CanvasAppearance({
  ownerId,
  canvasId,
  children,
}: {
  ownerId: number;
  canvasId: number;
  children: React.ReactNode;
}) {
  const key = `canvas_appearance_v1_${ownerId}_${canvasId}`;
  const [value, setValue] = React.useState<Appearance>(defaults);
  React.useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(key) || "null");
      setValue({
        pattern: ["dots", "grid", "solid"].includes(saved?.pattern)
          ? saved.pattern
          : "dots",
        background: isColor(saved?.background) ? saved.background : "",
        highlight: isColor(saved?.highlight) ? saved.highlight : "",
      });
    } catch {
      setValue(defaults);
    }
  }, [key]);
  const update = (patch: Partial<Appearance>) => {
    const next = { ...value, ...patch };
    setValue(next);
    try {
      window.localStorage.setItem(key, JSON.stringify(next));
    } catch {
      /* Keep controls usable when storage is unavailable. */
    }
  };
  const style = {
    ...(value.background
      ? {
          "--canvas-bg": value.background,
          "--canvas-bg-dot":
            "color-mix(in srgb, var(--canvas-bg) 75%, #888888)",
        }
      : {}),
    ...(value.highlight
      ? {
          "--canvas-edge-flow": value.highlight,
          "--canvas-edge-flow-tail": value.highlight,
          "--canvas-edge-hover": value.highlight,
          "--canvas-edge-selected": value.highlight,
          "--canvas-edge-flow-glow": `drop-shadow(0 0 2px ${value.highlight}cc) drop-shadow(0 0 6px ${value.highlight}73)`,
        }
      : {}),
  } as React.CSSProperties;
  return (
    <Context.Provider value={{ value, update }}>
      <div
        data-canvas-appearance
        className="relative flex min-h-0 min-w-0 flex-1"
        style={style}
      >
        {children}
      </div>
    </Context.Provider>
  );
}

const backgrounds = [
  ["默认", ""],
  ["暖灰", "#242320"],
  ["冷灰", "#1c2327"],
  ["纸白", "#f3f0e7"],
  ["雾绿", "#1e2923"],
  ["雾蓝", "#1c2930"],
  ["淡紫", "#272230"],
  ["浅粉", "#302426"],
  ["沙色", "#30291d"],
];
const highlights = [
  ["默认", ""],
  ["蓝色", "#69b5fd"],
  ["紫色", "#b59aff"],
  ["绿色", "#65d6a0"],
  ["橙色", "#ffb86b"],
  ["粉色", "#f594c1"],
];

export function CanvasAppearanceSettings() {
  const { text, label: uiLabel } = useUiLocale();
  const { value, update } = useCanvasAppearance();
  const [open, setOpen] = React.useState(false);
  const root = React.useRef<HTMLDivElement>(null);
  const trigger = React.useRef<HTMLButtonElement>(null);
  const panel = React.useRef<HTMLDivElement>(null);
  const id = React.useId();
  React.useEffect(() => {
    if (!open) return;
    panel.current?.focus();
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest('[data-canvas-color-popover]')?.getAttribute('data-canvas-color-popover') === id) return;
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (Array.from(document.querySelectorAll('[data-canvas-color-popover]')).some(element => element.getAttribute('data-canvas-color-popover') === id)) return;
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", escape, true);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("keydown", escape, true);
    };
  }, [open, id]);
  const colors = (field: "background" | "highlight", options: string[][]) => (
    <>
      <div className="grid grid-cols-3 gap-1.5">
        {options.map(([label, color]) => (
          <button key={label} type="button"
            aria-label={text("workspaceFollowup.m7fbd3e07de74", { v0: field === "background" ? text("workspaceFollowup.mf4b669c55756") : text("workspaceFollowup.mf799c2308083"), v1: uiLabel(label) })}
            aria-pressed={value[field] === color}
            onClick={() => update({ [field]: color })}
            className="canvas-appearance-option">
            <span className="relative block h-8" style={{ background: field === "background" ? color || "var(--canvas-bg)" : undefined }}>
              {field === "highlight" && <span className="absolute left-3 right-3 top-4 h-0.5 rounded" style={{ background: color || "linear-gradient(90deg, var(--canvas-edge-flow-tail), var(--canvas-edge-flow))" }} />}
              {value[field] === color && <Check className="absolute right-1 top-1 h-3.5 w-3.5 rounded-full bg-[var(--canvas-controls-bg)] text-[var(--canvas-controls-text)]" />}
            </span>
            <span className="block border-t border-[var(--canvas-controls-border)] py-1">{uiLabel(label)}</span>
          </button>
        ))}
      </div>
      <label className="mt-2 flex items-center justify-between text-xs text-[var(--canvas-controls-text-muted)]"><UiText id="canvas.m781b07fdcb56" /><CanvasColorPopover
          ownerId={id}
          label={text("workspaceFollowup.m215dc373b760", { v0: field === "background" ? text("workspaceFollowup.m882fe2e84241") : text("workspaceFollowup.m3856a2c4b930") })}
          value={value[field] || (field === "background" ? "#141414" : "#69b5fd")}
          onChange={color => update({ [field]: color })}
        />
      </label>
    </>
  );
  return (
    <div ref={root}>
      <UiProps ids={{"aria-label":["canvas.mce6da073fd86"],"title":["canvas.mce6da073fd86"]}}><button
        ref={trigger}
        type="button"
        aria-label="canvas.mce6da073fd86"
        title="canvas.mce6da073fd86"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen(!open)}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md hover:bg-[var(--canvas-controls-hover)]"
      >
        <Settings2 className="h-4 w-4" />
      </button></UiProps>
      {open && (
        <UiProps ids={{"aria-label":["canvas.mce6da073fd86"]}}><div
          ref={panel}
          id={id}
          role="dialog"
          aria-label="canvas.mce6da073fd86"
          tabIndex={-1}
          onWheel={(event) => event.stopPropagation()}
          className="absolute left-0 top-[48px] max-h-[calc(100dvh-90px)] w-[288px] max-w-[calc(100vw-24px)] overflow-y-auto rounded-[14px] border border-[var(--canvas-controls-border)] bg-[var(--canvas-controls-bg)] p-3 text-[var(--canvas-controls-text)] shadow-[var(--canvas-shadow-dropdown)] outline-none"
        >
          <div className="mb-3 flex items-center justify-between text-xs font-semibold"><UiText id="canvas.mce6da073fd86" /><UiProps ids={{"aria-label":["canvas.m026d2119e5e5"]}}><button
              type="button"
              aria-label="canvas.m026d2119e5e5"
              onClick={() => {
                setOpen(false);
                trigger.current?.focus();
              }}
              className="rounded p-1 hover:bg-[var(--canvas-controls-hover)]"
            >
              <X className="h-3.5 w-3.5" />
            </button></UiProps>
          </div>
          <fieldset>
            <legend className="mb-2 text-xs text-[var(--canvas-controls-text-muted)]"><UiText id="canvas.mc678238b57a5" /></legend>
            <div className="grid grid-cols-3 gap-1.5">
              {(
                [
                  ["dots", "点阵"],
                  ["grid", "网格"],
                  ["solid", "纯色"],
                ] as const
              ).map(([pattern, label]) => (
                <button
                  key={pattern}
                  type="button"
                  aria-pressed={value.pattern === pattern}
                  onClick={() => update({ pattern })}
                  className="canvas-appearance-option"
                >
                  <span
                    className="relative block h-9 bg-[var(--canvas-bg)]"
                    style={{
                      backgroundImage:
                        pattern === "dots"
                          ? "radial-gradient(#88888880 1px, transparent 1px)"
                          : pattern === "grid"
                            ? "linear-gradient(color-mix(in srgb, var(--canvas-bg-dot) 24%, transparent) 0.6px, transparent 0.6px), linear-gradient(90deg, color-mix(in srgb, var(--canvas-bg-dot) 24%, transparent) 0.6px, transparent 0.6px)"
                            : "none",
                      backgroundSize: "12px 12px",
                    }}
                  >
                    {value.pattern === pattern && (
                      <Check className="absolute right-1 top-1 h-3.5 w-3.5 rounded-full bg-[var(--canvas-controls-bg)]" />
                    )}
                  </span>
                  <span className="block border-t border-[var(--canvas-controls-border)] py-1">
                    {uiLabel(label)}
                  </span>
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset className="mt-3">
            <legend className="mb-2 text-xs text-[var(--canvas-controls-text-muted)]"><UiText id="canvas.m882fe2e84241" /></legend>
            {colors("background", backgrounds)}
          </fieldset>
          <fieldset className="mt-3">
            <legend className="mb-2 text-xs text-[var(--canvas-controls-text-muted)]"><UiText id="canvas.m3856a2c4b930" /></legend>
            {colors("highlight", highlights)}
          </fieldset>
          <button
            type="button"
            onClick={() => update(defaults)}
            className="mt-3 w-full rounded-lg py-1.5 text-xs text-[var(--canvas-controls-text-muted)] hover:bg-[var(--canvas-controls-hover)]"
          ><UiText id="canvas.mba2e93e73037" /></button>
        </div></UiProps>
      )}
    </div>
  );
}
