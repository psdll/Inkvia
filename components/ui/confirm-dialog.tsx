"use client";
import { UiProps, UiText, useUiLocale } from "@/i18n/ui";


import * as React from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

const dialogStack: HTMLElement[] = [];
let bodyOverflowBeforeDialogs = "";

function focusableElements(dialog: HTMLElement) {
  return Array.from(dialog.querySelectorAll<HTMLElement>("button, [href], input, select, textarea, [tabindex], [contenteditable='true']"))
    .filter((element) => {
      if (element.tabIndex < 0 || element.matches(":disabled") || element.closest("[hidden], [inert]")) return false;
      for (let node: HTMLElement | null = element; node && node !== dialog; node = node.parentElement) {
        const style = window.getComputedStyle(node);
        if (style.display === "none" || style.visibility === "hidden") return false;
      }
      return true;
    });
}

export type ConfirmDialogProps = {
  open: boolean;
  zIndex?: number;
  placement?: "center" | "right";
  focusPanelOnOpen?: boolean;
  footerActions?: React.ReactNode;
  title: string;
  description?: string;
  children?: React.ReactNode;
  confirmText?: string;
  confirmDisabled?: boolean;
  headerActions?: React.ReactNode;
  cancelText?: string;
  showCancel?: boolean;
  danger?: boolean;
  dimBackdrop?: boolean;
  darkSolidSurface?: boolean;
  onConfirm: () => boolean | void | Promise<boolean | void>;
  onClose: () => void;
};

export function ConfirmDialog({
  open,
  zIndex,
  placement = "center",
  focusPanelOnOpen = false,
  footerActions,
  title,
  description,
  children,
  confirmText: confirmTextProp,
  confirmDisabled = false,
  headerActions,
  cancelText: cancelTextProp,
  showCancel = true,
  danger,
  dimBackdrop = true,
  darkSolidSurface = false,
  onConfirm,
  onClose
}: ConfirmDialogProps) {
  const { text } = useUiLocale();
  const confirmText = confirmTextProp ?? text("createDynamic.mfac2a67ad878");
  const cancelText = cancelTextProp ?? text("createDynamic.m2cd0f3be8738");
  const [mounted, setMounted] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const submittingRef = React.useRef(false);
  const dialogRef = React.useRef<HTMLDivElement>(null);
  const cancelRef = React.useRef<HTMLButtonElement>(null);
  const confirmRef = React.useRef<HTMLButtonElement>(null);
  const openerRef = React.useRef<HTMLElement | null>(null);
  const wasOpenRef = React.useRef(false);
  const titleId = React.useId();
  const descriptionId = React.useId();
  // Capture before a child's autoFocus can replace the invoking control.
  if (open && !wasOpenRef.current && typeof document !== "undefined") {
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }
  wasOpenRef.current = open;

  React.useEffect(() => setMounted(true), []);

  const close = React.useCallback(() => {
    if (submittingRef.current) return;
    onClose();
  }, [onClose, submitting]);

  const submit = React.useCallback(async () => {
    if (submittingRef.current || confirmDisabled) return;
    submittingRef.current = true;
    setSubmitting(true);
    try {
      const shouldClose = await onConfirm();
      if (shouldClose !== false) onClose();
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }, [onClose, onConfirm, submitting, confirmDisabled]);

  const handlersRef = React.useRef({ close, submit });
  handlersRef.current = { close, submit };

  React.useEffect(() => {
    const dialog = dialogRef.current;
    if (!open || !mounted || !dialog) return;
    const opener = openerRef.current;
    if (dialogStack.length === 0) bodyOverflowBeforeDialogs = document.body.style.overflow;
    dialogStack.push(dialog);
    document.body.style.overflow = "hidden";
    const isTopDialog = () => dialogStack[dialogStack.length - 1] === dialog;
    const firstInput = focusableElements(dialog).find((element) => element.matches("input, textarea, select, [contenteditable='true']"));
    const initialFocus = focusPanelOnOpen ? dialog : danger ? cancelRef.current : firstInput || confirmRef.current;
    (initialFocus || dialog).focus();
    const onFocusIn = (e: FocusEvent) => {
      if (!isTopDialog() || dialog.contains(e.target as Node)) return;
      (focusableElements(dialog)[0] || dialog).focus();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (!isTopDialog() || e.defaultPrevented || e.isComposing || e.keyCode === 229) return;
      if (e.key === "Escape") {
        if (dialog.querySelector("[data-frosted-select-menu]")) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        handlersRef.current.close();
        return;
      }
      if (e.key === "Tab") {
        const elements = focusableElements(dialog);
        const first = elements[0] || dialog;
        const last = elements[elements.length - 1] || dialog;
        if (!elements.length || !dialog.contains(document.activeElement) || document.activeElement === dialog || (e.shiftKey ? document.activeElement === first : document.activeElement === last)) {
          e.preventDefault();
          (e.shiftKey ? last : first).focus();
        }
        return;
      }
      if (e.key !== "Enter" || e.shiftKey || !dialog.contains(e.target as Node)) return;
      const target = e.target instanceof HTMLElement ? e.target : null;
      if (target?.tagName === "TEXTAREA" || target?.isContentEditable) return;
      if (target?.closest("button,a[href],[role='button']")) return;
      e.preventDefault();
      void handlersRef.current.submit();
    };
    window.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("focusin", onFocusIn);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("focusin", onFocusIn);
      const wasTop = isTopDialog();
      dialogStack.splice(dialogStack.indexOf(dialog), 1);
      if (dialogStack.length === 0) document.body.style.overflow = bodyOverflowBeforeDialogs;
      if (wasTop && opener?.isConnected) opener.focus();
    };
  }, [open, mounted, danger, focusPanelOnOpen]);

  const modal =
    open && mounted ? (
      <div className="fixed inset-0 z-[180]" style={{ zIndex }}>
        <div className={["absolute inset-0", dimBackdrop ? "bg-[var(--overlay)]" : "bg-transparent"].join(" ")} onClick={close} />
        <div className={placement === "right" ? "absolute inset-0 flex justify-end" : "absolute inset-0 p-4 flex items-center justify-center"} onClick={(event) => { if (event.target === event.currentTarget) close(); }}>
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={description ? descriptionId : undefined}
            aria-busy={submitting}
            tabIndex={-1}
            className={[
              placement === "right" ? "relative flex h-full w-full max-w-[480px] flex-col border-l border-[var(--border)] bg-[var(--panel-bg)] shadow-[var(--shadow)]" : "relative w-full max-w-[520px] rounded-[22px] border border-[var(--border)] bg-[var(--panel-bg)] shadow-[var(--shadow)] overflow-hidden",
              darkSolidSurface ? "dark:border-[#3a3a3a] dark:bg-[#262626]" : ""
            ].join(" ")}
          >
            <div
              className={[
                placement === "right" ? "h-[60px] shrink-0 px-5 flex items-center justify-between border-b border-[var(--border)] bg-[var(--panel-bg)]" : "h-[52px] px-4 flex items-center justify-between border-b border-[var(--border)] bg-[var(--panel-bg)]",
                darkSolidSurface ? "dark:border-[#3a3a3a] dark:bg-[#262626]" : ""
              ].join(" ")}
            >
              <div id={titleId} className="text-[var(--app-fg)] font-semibold text-sm truncate">{title}</div>
              <div className="flex items-center gap-2">
              {headerActions}
              <UiProps ids={{"aria-label":["common.m3fd47edce45b"]}}><button
                type="button"
                onClick={close}
                className="h-9 w-9 rounded-xl border border-[var(--border)] bg-[var(--panel-2)] text-[var(--app-muted)] hover:bg-[var(--panel-3)] hover:text-[var(--app-fg)] transition flex items-center justify-center disabled:opacity-40 disabled:pointer-events-none"
                aria-label="common.m3fd47edce45b"
                disabled={submitting}
              >
                <X className="h-4 w-4" />
              </button></UiProps>
              </div>
            </div>
            <div className={placement === "right" ? "min-h-0 flex-1 overflow-y-auto p-6" : "p-4"}>
              {description ? <div id={descriptionId} className="text-sm text-[var(--app-muted)] leading-relaxed">{description}</div> : null}
              {children ? <div className={description ? "mt-4" : ""}>{children}</div> : null}
            </div>
              <div className={placement === "right" ? "flex shrink-0 items-center justify-end gap-2 border-t border-[var(--border)] p-5" : "flex items-center justify-end gap-2 px-4 pb-4"}>
                {footerActions ? <div className="mr-auto">{footerActions}</div> : null}
                {showCancel ? (
                  <button
                    ref={cancelRef}
                    type="button"
                    onClick={close}
                    disabled={submitting}
                    className="h-10 shrink-0 whitespace-nowrap px-4 rounded-2xl border border-[var(--border)] bg-[var(--panel-2)] text-sm text-[var(--app-fg)] hover:bg-[var(--panel-3)] transition disabled:opacity-50 disabled:pointer-events-none"
                  >
                    {cancelText}
                  </button>
                ) : null}
                <button
                  ref={confirmRef}
                  type="button"
                  onClick={submit}
                  disabled={submitting || confirmDisabled}
                  className={[
                    "h-10 shrink-0 whitespace-nowrap px-4 rounded-2xl border text-sm transition disabled:opacity-50 disabled:pointer-events-none",
                    danger
                      ? "border-rose-500/20 bg-rose-500/10 text-rose-700 dark:text-rose-400 hover:bg-rose-500/15"
                      : placement === "right" ? "border-transparent bg-[var(--primary-bg)] text-[var(--primary-fg)]" : "border-[var(--border)] bg-[var(--panel-bg)] text-[var(--app-fg)] hover:bg-[var(--panel-2)]"
                  ].join(" ")}
                >
                  {submitting ? <UiText id="common.mc1fd812f81ca" /> : confirmText}
                </button>
              </div>
          </div>
        </div>
      </div>
    ) : null;

  if (!mounted) return null;
  return modal ? createPortal(modal, document.body) : null;
}
