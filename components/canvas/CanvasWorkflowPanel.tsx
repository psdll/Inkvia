"use client";

import { UiProps, UiText, useUiLocale } from "@/i18n/ui";


import * as React from "react";
import { FolderInput, Package, Upload, X } from "lucide-react";
import { FrostedSelect } from "@/components/ui/frosted-select";
import { useCanvasReadOnly } from "./CanvasReadOnlyContext";
import "./canvas-workflow.css";

export type WorkflowExportScope = "selected" | "full";
export type WorkflowImportMode = "append" | "replace";

type Props = {
  selectedCount: number;
  totalCount: number;
  anchorRef?: React.RefObject<HTMLButtonElement>;
  onClose: () => void;
  transferBusy?: boolean;
  onExport: (scope: WorkflowExportScope, format: "zip" | "library") => Promise<void>;
  onImport: (file: File, mode: WorkflowImportMode) => Promise<void>;
};

export default function CanvasWorkflowPanel({ selectedCount, totalCount, anchorRef, onClose, onExport, onImport, transferBusy = false }: Props) {
  const { text, label: uiLabel } = useUiLocale();
  const readOnly = useCanvasReadOnly();
  const [importMode, setImportMode] = React.useState<WorkflowImportMode>("append");
  const [localBusy, setBusy] = React.useState(false);
  const busy = localBusy || transferBusy;
  const [message, setMessage] = React.useState("");
  const runningRef = React.useRef(false);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const panelRef = React.useRef<HTMLElement>(null);
  const [placement, setPlacement] = React.useState<{ left: number; bottom: number; arrow: number }>();
  const selectedReason = busy ? "正在处理，请稍候" : !selectedCount ? "请先在画布选中节点" : undefined;
  const fullReason = busy ? "正在处理，请稍候" : !totalCount ? "画布暂无节点" : undefined;

  React.useLayoutEffect(() => {
    const panel = panelRef.current;
    const anchor = anchorRef?.current;
    const parent = panel?.parentElement;
    if (!panel || !anchor || !parent) return;
    const update = () => {
      const bounds = parent.getBoundingClientRect();
      const button = anchor.getBoundingClientRect();
      const width = panel.getBoundingClientRect().width;
      const center = button.left + button.width / 2 - bounds.left;
      const left = Math.max(12 + width / 2, Math.min(bounds.width - 12 - width / 2, center));
      setPlacement({ left, bottom: bounds.bottom - button.top + 16, arrow: Math.max(16, Math.min(width - 16, center - left + width / 2)) });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(parent);
    observer.observe(panel);
    window.addEventListener("resize", update);
    return () => { observer.disconnect(); window.removeEventListener("resize", update); };
  }, [anchorRef]);

  React.useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  const run = async (action: () => Promise<void>, success: string) => {
    if (runningRef.current || transferBusy) return;
    runningRef.current = true;
    setBusy(true);
    setMessage("");
    try { await action(); setMessage(success); }
    catch (error) { setMessage(String((error as Error)?.message || error)); }
    finally { runningRef.current = false; setBusy(false); }
  };

  const importFile = async (file: File) => run(async () => {
    if (readOnly) throw new Error("查看模式不能导入工作流");
    if (!file.name.toLowerCase().endsWith(".zip")) throw new Error("请选择 ZIP 工作流文件");
    await onImport(file, importMode);
  }, importMode === "append" ? "已追加到当前画布" : "已替换当前画布");

  return (
    <UiProps ids={{"aria-label":["canvas.mc71d0bca46eb"]}}><aside ref={panelRef} id="canvas-workflow-panel" aria-label="canvas.mc71d0bca46eb" aria-busy={busy} className="canvas-workflow-panel nodrag nopan nowheel" style={placement ? { left: placement.left, bottom: placement.bottom } : undefined} onPointerDown={event => event.stopPropagation()} onWheel={event => event.stopPropagation()}>
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-[var(--canvas-controls-border)] px-6">
        <Package className="h-4 w-4 text-[var(--primary-bg)]" />
        <div><h2 className="text-sm font-semibold text-[var(--app-fg)]"><UiText id="canvas.mc71d0bca46eb" /></h2><p className="text-[10px] text-[var(--app-muted)]"><UiText id="canvas.m04811ca1ef73" /></p></div>
        <UiProps ids={{"aria-label":["canvas.m7894c6b47217"]}}><button type="button" onClick={onClose} aria-label="canvas.m7894c6b47217" className="ml-auto rounded-lg p-1.5 text-[var(--app-muted)] hover:bg-[var(--panel-2)]"><X className="h-4 w-4" /></button></UiProps>
      </header>
      <div className="canvas-workflow-columns">
        <section className="canvas-workflow-section">
          <h3 className="text-xs font-semibold text-[var(--app-fg)]"><UiText id="canvas.meb481b719354" /></h3>
          {selectedCount > 0 && <p id="canvas-workflow-selection-hint" className="mt-2 text-xs text-[var(--app-fg)]">{<UiText id="canvas.mfd655f90ccbb" values={{v0: String(selectedCount)}} />}</p>}
          <p className="mt-1 text-[11px] text-[var(--app-muted)]">{selectedCount ? <UiText id="canvas.m0a037d75ece9" /> : <UiText id="canvas.m4b7aaa045733" />}</p>
          <p className="mt-1 text-[11px] text-[var(--app-muted)]"><UiText id="canvas.m46475c9717d8" /></p>
          <div className="mt-3 grid grid-cols-1 gap-2">
            <button type="button" disabled={!selectedCount || busy} title={selectedReason ? uiLabel(selectedReason) : undefined} aria-describedby="canvas-workflow-selection-hint" onClick={() => { void run(() => onExport("selected", "zip"), "含资源工作流已导出"); }} className="canvas-workflow-action canvas-workflow-action-primary"><Package className="h-3.5 w-3.5" /><UiText id="canvas.m3953c6307897" /></button>
            <UiProps ids={{"title":["canvas.mdfcba5ef9275"]}}><button type="button" disabled={readOnly || !selectedCount || busy} title={readOnly ? "canvas.mdfcba5ef9275" : selectedReason ? uiLabel(selectedReason) : undefined} aria-describedby="canvas-workflow-selection-hint" onClick={() => { void run(() => onExport("selected", "library"), "工作流已存入产物库"); }} className="canvas-workflow-action col-span-1"><FolderInput className="h-3.5 w-3.5" /><UiText id="canvas.ma68d137393e5" /></button></UiProps>
            <p id="canvas-workflow-full-hint" className="col-span-1 mt-2 border-t border-[var(--border)] pt-3 text-[11px] text-[var(--app-muted)]">{totalCount ? <UiText id="canvas.mececbf9bb462" values={{v0: String(totalCount)}} /> : <UiText id="canvas.mfadc29485e40" />}</p>
            <button type="button" disabled={!totalCount || busy} title={fullReason ? uiLabel(fullReason) : undefined} aria-describedby="canvas-workflow-full-hint" onClick={() => { void run(() => onExport("full", "zip"), "整张画布资源包已导出"); }} className="canvas-workflow-action canvas-workflow-action-primary"><UiText id="canvas.m09bd8b2b4700" /></button>
          </div>
        </section>
        <section className="canvas-workflow-section canvas-workflow-import">
          <div className="flex items-center gap-2"><h3 className="text-xs font-semibold text-[var(--app-fg)]"><UiText id="canvas.m0ccb8fbc3ead" /></h3><FrostedSelect disabled={readOnly || busy} value={importMode} onChange={(value) => setImportMode(value as WorkflowImportMode)} options={[{ value: "append", label: text("workspaceFollowup.m2bacb2a7985b") }, { value: "replace", label: text("workspaceFollowup.m3d6efe00c9bf") }]} ariaLabel={text("workspaceFollowup.m6a5e860f661b")} compact showLeading={false} side="auto" className="ml-auto w-32" /></div>
          <p className="mt-2 text-[11px] text-[var(--app-muted)]">{importMode === "append" ? <UiText id="canvas.m23b6be1ebc27" /> : <UiText id="canvas.ma79d8df26940" />}</p>
          <button type="button" disabled={readOnly || busy} onClick={() => inputRef.current?.click()} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); event.stopPropagation(); if (readOnly || runningRef.current) return; const file = event.dataTransfer.files[0]; if (file) void importFile(file); }} className="mt-4 flex min-h-32 flex-1 w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--border-2,var(--border))] text-xs text-[var(--app-muted)] hover:bg-[var(--panel-2)] disabled:opacity-40"><Upload className="h-5 w-5" /><span><UiText id="canvas.m6487014b7b2b" /></span></button>
          <input ref={inputRef} type="file" accept=".zip,application/zip" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importFile(file); event.target.value = ""; }} />
        </section>
        {busy && <p role="status" className="canvas-workflow-status text-xs text-[var(--app-muted)]"><UiText id="canvas.mbe33418e0881" /></p>}
        {message && <p role="status" className="canvas-workflow-status rounded-lg bg-[var(--panel-2)] px-3 py-2 text-xs text-[var(--app-muted)]">{uiLabel(message)}</p>}
      </div>
      <span aria-hidden="true" className="canvas-workflow-arrow" style={{ left: placement?.arrow ?? "50%" }}><svg width="16" height="10" viewBox="0 0 16 10" fill="none"><path d="M0 2 6.6 8.4a2 2 0 0 0 2.8 0L16 2" fill="var(--canvas-controls-bg)" stroke="var(--canvas-controls-border)" /><path d="M0 0h16v2H0z" fill="var(--canvas-controls-bg)" /></svg></span>
    </aside></UiProps>
  );
}
