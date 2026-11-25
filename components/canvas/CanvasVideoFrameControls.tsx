"use client";
import { UiProps } from "@/i18n/ui";


import { useCanvasReadOnly } from "./CanvasReadOnlyContext";
import * as React from "react";
import { VideoFrameMenu } from "@/components/ui/video-frame-menu";
import { captureVideoFrame, captureVideoFrameFromSource, type CapturedVideoFrame } from "@/lib/browser/video-frame-capture";
import type { VideoFrameMode } from "@/lib/video-frame";

type FrameMenu = "toolbar" | "player";
type FrameActions = {
  videoRef: React.MutableRefObject<HTMLVideoElement | null>;
  timeRef: React.MutableRefObject<number>;
  busy: boolean;
  openMenu: FrameMenu | null;
  setOpenMenu: React.Dispatch<React.SetStateAction<FrameMenu | null>>;
  capture: (mode: VideoFrameMode) => void;
};

export const CanvasVideoFrameContext = React.createContext<FrameActions | null>(null);

export function CanvasVideoFrameProvider({ src, onCapture, children }: {
  src: string;
  onCapture: (frame: CapturedVideoFrame, mode: VideoFrameMode) => Promise<void>;
  children: React.ReactNode;
}) {
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const timeRef = React.useRef(0);
  const pending = React.useRef(false);
  const mounted = React.useRef(true);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const [openMenu, setOpenMenu] = React.useState<FrameMenu | null>(null);
  React.useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const capture = React.useCallback((mode: VideoFrameMode) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    setOpenMenu(null);
    // Start immediately: the current frame is drawn before playback can advance.
    const video = videoRef.current;
    const frame = video && mode === "current"
      ? captureVideoFrame(video, "current")
      : captureVideoFrameFromSource(src, mode, timeRef.current);
    void frame.then((result) => mounted.current ? onCapture(result, mode) : undefined).catch((reason) => {
      if (mounted.current) setError(String(reason?.message || "视频截帧失败，请重试"));
    }).finally(() => {
      pending.current = false;
      if (mounted.current) setBusy(false);
    });
  }, [src, onCapture]);

  const value = React.useMemo(() => ({ videoRef, timeRef, busy, openMenu, setOpenMenu, capture }), [busy, openMenu, capture]);
  return (
    <CanvasVideoFrameContext.Provider value={value}>
      {children}
      {error ? <div role="alert" className="nodrag nowheel absolute left-0 top-full z-30 mt-2 max-w-80 rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] px-3 py-2 text-xs text-[var(--app-fg)] shadow-[var(--shadow-2)]">{error}</div> : null}
    </CanvasVideoFrameContext.Provider>
  );
}

export function CanvasVideoFrameControl({ placement, visible = true }: { placement: FrameMenu; visible?: boolean }) {
  const readOnly = useCanvasReadOnly();
  const actions = React.useContext(CanvasVideoFrameContext);
  const setOpenMenu = actions?.setOpenMenu;
  const onOpenChange = React.useCallback((open: boolean) => {
    setOpenMenu?.((current) => open ? placement : current === placement ? null : current);
  }, [setOpenMenu, placement]);
  if (!actions) return null;
  return <UiProps ids={{"label":["canvas.mf8974daa333d"]}}><VideoFrameMenu
    open={actions.openMenu === placement}
    onOpenChange={onOpenChange}
    busy={actions.busy}
    disabled={readOnly}
    visible={visible}
    compact
    label={placement === "toolbar" ? "canvas.mf8974daa333d" : undefined}
    placement={placement === "toolbar" ? "bottom" : "top"}
    buttonClassName={placement === "toolbar" ? "canvas-material-toolbar-item" : "canvas-video-frame-button"}
    onSelect={actions.capture}
  /></UiProps>;
}
