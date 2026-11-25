"use client";
import { UiProps, UiText, useUiLocale } from "@/i18n/ui";


import * as React from "react";
import { VideoFrameMenu } from "@/components/ui/video-frame-menu";
import type { VideoFrameMode } from "@/lib/video-frame";
import {
  Maximize,
  Pause,
  PictureInPicture2,
  Play,
  Volume2,
  VolumeX,
} from "lucide-react";

export const APP_VIDEO_PLAYBACK_RATES = [0.5, 0.75, 1, 1.5, 2] as const;

export type AppVideoNaturalSize = {
  width: number;
  height: number;
  ratio: number;
};

export type AppVideoPlayerProps = Omit<
  React.VideoHTMLAttributes<HTMLVideoElement>,
  "controls"
> & {
  containerClassName?: string;
  compact?: boolean;
  controlsOnHover?: boolean;
  showCenterControl?: boolean;
  playOnSurfaceClick?: boolean;
  controlPreset?: "default" | "canvasPreview";
  onNaturalSize?: (size: AppVideoNaturalSize) => void;
  onCaptureFrame?: (video: HTMLVideoElement, mode: VideoFrameMode) => void;
  frameCaptureBusy?: boolean;
};

export function formatAppVideoTime(value: number) {
  if (!Number.isFinite(value) || value < 0) return "0:00";
  const totalSeconds = Math.floor(value);
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function clampAppVideoTime(value: number, duration: number) {
  if (!Number.isFinite(value) || !Number.isFinite(duration) || duration <= 0) return 0;
  return Math.min(Math.max(value, 0), duration);
}

export function getNextAppVideoPlaybackRate(current: number) {
  const index = APP_VIDEO_PLAYBACK_RATES.findIndex((rate) => rate === current);
  return APP_VIDEO_PLAYBACK_RATES[(index + 1) % APP_VIDEO_PLAYBACK_RATES.length];
}

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    ["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(target.tagName)
  );
}

export const AppVideoPlayer = React.forwardRef<HTMLVideoElement, AppVideoPlayerProps>(
  function AppVideoPlayer(
    {
      className,
      containerClassName,
      compact = false,
      controlsOnHover = false,
      showCenterControl = true,
      playOnSurfaceClick = true,
      controlPreset = "default",
      onNaturalSize,
      onCaptureFrame,
      frameCaptureBusy = false,
      onLoadedMetadata,
      onDurationChange,
      onTimeUpdate,
      onPlay,
      onPause,
      onEnded,
      onVolumeChange,
      onRateChange,
      onError,
      onLoadStart,
      onClick,
      onDoubleClick,
      ...videoProps
    },
    forwardedRef,
  ) {
    const { text } = useUiLocale();
    const containerRef = React.useRef<HTMLDivElement | null>(null);
    const videoRef = React.useRef<HTMLVideoElement | null>(null);
    const hideTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
    const lastPointerWasTouchRef = React.useRef(false);
    const [paused, setPaused] = React.useState(true);
    const [ended, setEnded] = React.useState(false);
    const [currentTime, setCurrentTime] = React.useState(0);
    const [duration, setDuration] = React.useState(0);
    const [volume, setVolume] = React.useState(1);
    const [muted, setMuted] = React.useState(Boolean(videoProps.muted));
    const [playbackRate, setPlaybackRate] = React.useState(1);
    const [rateMenuOpen, setRateMenuOpen] = React.useState(false);
    const [frameMenuOpen, setFrameMenuOpen] = React.useState(false);
    const [controlsVisible, setControlsVisible] = React.useState(!controlsOnHover);
    const [failed, setFailed] = React.useState(false);
    const [pictureInPicture, setPictureInPicture] = React.useState(false);
    const [fullscreen, setFullscreen] = React.useState(false);
    const [canPictureInPicture, setCanPictureInPicture] = React.useState(false);
    const [canFullscreen, setCanFullscreen] = React.useState(false);
    const canvasPreview = controlPreset === "canvasPreview";

    React.useImperativeHandle(forwardedRef, () => videoRef.current as HTMLVideoElement, []);

    const clearHideTimer = React.useCallback(() => {
      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
      }
    }, []);

    const scheduleControlsHide = React.useCallback(() => {
      clearHideTimer();
      if (controlsOnHover) return;
      if (paused || ended || failed || rateMenuOpen || frameMenuOpen) return;
      hideTimerRef.current = setTimeout(() => setControlsVisible(false), 2_500);
    }, [clearHideTimer, controlsOnHover, ended, failed, paused, rateMenuOpen, frameMenuOpen]);

    const hideControls = React.useCallback(() => {
      clearHideTimer();
      if (frameMenuOpen) return;
      if (controlsOnHover) {
        setRateMenuOpen(false);
        setControlsVisible(false);
        return;
      }
      if (!paused && !ended && !failed && !rateMenuOpen) {
        setControlsVisible(false);
      }
    }, [clearHideTimer, controlsOnHover, ended, failed, paused, rateMenuOpen, frameMenuOpen]);

    const revealControls = React.useCallback(() => {
      setControlsVisible(true);
      scheduleControlsHide();
    }, [scheduleControlsHide]);

    React.useEffect(() => {
      scheduleControlsHide();
      return clearHideTimer;
    }, [clearHideTimer, scheduleControlsHide]);

    React.useEffect(() => {
      setFailed(false);
      setCurrentTime(0);
      setDuration(0);
      setEnded(false);
      setRateMenuOpen(false);
      setFrameMenuOpen(false);
      setControlsVisible(!controlsOnHover);
    }, [controlsOnHover, videoProps.src]);

    React.useEffect(() => {
      if (typeof document === "undefined") return;
      const video = videoRef.current;
      const container = containerRef.current;
      setCanPictureInPicture(
        Boolean(document.pictureInPictureEnabled && video && !video.disablePictureInPicture),
      );
      setCanFullscreen(Boolean(document.fullscreenEnabled && container?.requestFullscreen));

      const handleFullscreenChange = () => {
        setFullscreen(document.fullscreenElement === containerRef.current);
      };
      const handleEnterPictureInPicture = () => setPictureInPicture(true);
      const handleLeavePictureInPicture = () => setPictureInPicture(false);
      document.addEventListener("fullscreenchange", handleFullscreenChange);
      video?.addEventListener("enterpictureinpicture", handleEnterPictureInPicture);
      video?.addEventListener("leavepictureinpicture", handleLeavePictureInPicture);
      return () => {
        document.removeEventListener("fullscreenchange", handleFullscreenChange);
        video?.removeEventListener("enterpictureinpicture", handleEnterPictureInPicture);
        video?.removeEventListener("leavepictureinpicture", handleLeavePictureInPicture);
      };
    }, [videoProps.disablePictureInPicture, videoProps.src]);

    const togglePlayback = React.useCallback(() => {
      const video = videoRef.current;
      if (!video || failed) return;
      if (video.paused) {
        if (video.ended) video.currentTime = 0;
        void video.play().catch(() => setControlsVisible(true));
      } else {
        video.pause();
      }
    }, [failed]);

    const seekBy = React.useCallback((seconds: number) => {
      const video = videoRef.current;
      if (!video) return;
      video.currentTime = clampAppVideoTime(video.currentTime + seconds, video.duration);
    }, []);

    const toggleMuted = React.useCallback(() => {
      const video = videoRef.current;
      if (!video) return;
      video.muted = !video.muted;
    }, []);

    const togglePictureInPicture = React.useCallback(async () => {
      const video = videoRef.current;
      if (!video || !canPictureInPicture) return;
      try {
        if (document.pictureInPictureElement === video) {
          await document.exitPictureInPicture();
        } else {
          await video.requestPictureInPicture();
        }
      } catch {
        setPictureInPicture(false);
      }
    }, [canPictureInPicture]);

    const toggleFullscreen = React.useCallback(async () => {
      const container = containerRef.current;
      if (!container || !canFullscreen) return;
      try {
        if (document.fullscreenElement === container) {
          await document.exitFullscreen();
        } else {
          await container.requestFullscreen();
        }
      } catch {
        setFullscreen(false);
      }
    }, [canFullscreen]);

    const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (isEditableTarget(event.target)) return;
      const key = event.key.toLowerCase();
      if (event.code === "Space" || key === "k") {
        event.preventDefault();
        togglePlayback();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        seekBy(-5);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        seekBy(5);
      } else if (key === "m") {
        event.preventDefault();
        toggleMuted();
      } else if (key === "f") {
        event.preventDefault();
        void toggleFullscreen();
      }
      revealControls();
    };

    const handleSurfaceClick = (event: React.MouseEvent<HTMLDivElement>) => {
      if ((event.target as HTMLElement).closest("[data-app-video-controls]")) return;
      onClick?.(event as unknown as React.MouseEvent<HTMLVideoElement>);
      if (lastPointerWasTouchRef.current && !controlsVisible) {
        revealControls();
        return;
      }
      if (playOnSurfaceClick) togglePlayback();
      revealControls();
    };

    const handleSurfaceDoubleClick = (event: React.MouseEvent<HTMLDivElement>) => {
      if ((event.target as HTMLElement).closest("[data-app-video-controls]")) return;
      onDoubleClick?.(event as unknown as React.MouseEvent<HTMLVideoElement>);
      void toggleFullscreen();
    };

    const progressPercent = duration > 0
      ? (clampAppVideoTime(currentTime, duration) / duration) * 100
      : 0;
    const controlButtonClass = compact
      ? "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-white transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
      : "flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80";
    const controlsShellClass = compact
      ? "h-12 px-1.5 pb-1.5"
      : "h-[100px] px-[14px] pb-5";
    const controlsRowClass = compact
      ? "bottom-1.5 left-1.5 right-1.5 h-7"
      : "bottom-5 left-[14px] right-[14px] h-9";
    const progressPositionClass = compact
      ? "left-2 right-2 top-1"
      : "left-5 right-5 top-5";

    return (
      <UiProps ids={{"aria-label":["common.md8d406b7e0aa"]}}><div
        ref={containerRef}
        data-app-video-player
        className={[
          "group/app-video relative isolate overflow-hidden bg-black outline-none",
          containerClassName,
        ]
          .filter(Boolean)
          .join(" ")}
        role="group"
        aria-label="common.md8d406b7e0aa"
        tabIndex={0}
        onKeyDown={handleKeyDown}
        onClick={handleSurfaceClick}
        onDoubleClick={handleSurfaceDoubleClick}
        onPointerDown={(event) => {
          lastPointerWasTouchRef.current = event.pointerType === "touch";
        }}
        onPointerMove={(event) => {
          if (event.pointerType !== "touch") revealControls();
        }}
        onFocusCapture={() => {
          clearHideTimer();
          setControlsVisible(true);
        }}
        onBlurCapture={scheduleControlsHide}
        onMouseEnter={revealControls}
        onMouseLeave={hideControls}
      >
        <video
          {...videoProps}
          ref={videoRef}
          className={["block h-full w-full object-contain", className].filter(Boolean).join(" ")}
          onLoadStart={(event) => {
            setFailed(false);
            setEnded(false);
            onLoadStart?.(event);
          }}
          onLoadedMetadata={(event) => {
            const video = event.currentTarget;
            setDuration(Number.isFinite(video.duration) ? video.duration : 0);
            setCurrentTime(video.currentTime);
            setPaused(video.paused);
            setEnded(video.ended);
            if (video.videoWidth > 0 && video.videoHeight > 0) {
              onNaturalSize?.({
                width: video.videoWidth,
                height: video.videoHeight,
                ratio: video.videoWidth / video.videoHeight,
              });
            }
            onLoadedMetadata?.(event);
          }}
          onDurationChange={(event) => {
            setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0);
            onDurationChange?.(event);
          }}
          onTimeUpdate={(event) => {
            setCurrentTime(event.currentTarget.currentTime);
            onTimeUpdate?.(event);
          }}
          onPlay={(event) => {
            setPaused(false);
            setEnded(false);
            setControlsVisible(true);
            onPlay?.(event);
          }}
          onPause={(event) => {
            setPaused(true);
            setControlsVisible(true);
            onPause?.(event);
          }}
          onEnded={(event) => {
            setPaused(true);
            setEnded(true);
            setRateMenuOpen(false);
            setControlsVisible(false);
            onEnded?.(event);
          }}
          onVolumeChange={(event) => {
            setVolume(event.currentTarget.volume);
            setMuted(event.currentTarget.muted);
            onVolumeChange?.(event);
          }}
          onRateChange={(event) => {
            setPlaybackRate(event.currentTarget.playbackRate);
            onRateChange?.(event);
          }}
          onError={(event) => {
            setFailed(true);
            setPaused(true);
            setEnded(false);
            setControlsVisible(true);
            onError?.(event);
          }}
        />

        {failed ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/70 px-6 text-center text-sm text-white"><UiText id="common.m67f9aa8d4cbe" /></div>
        ) : null}

        {!failed && showCenterControl && paused && !ended ? (
          <div
            data-app-video-start
            className="pointer-events-none absolute inset-0 flex items-center justify-center"
          >
            <span
              className={[
                "flex items-center justify-center rounded-full bg-black/35 text-white shadow-[0_4px_24px_rgba(0,0,0,0.28)] backdrop-blur-[2px]",
                compact ? "h-14 w-14" : "h-[88px] w-[88px]",
              ].join(" ")}
            >
              <Play
                className={compact ? "h-6 w-6 translate-x-0.5" : "h-9 w-9 translate-x-1"}
                fill="currentColor"
              />
            </span>
          </div>
        ) : null}

        <div
          data-app-video-controls
          aria-hidden={!controlsVisible}
          className={[
            "absolute inset-x-0 bottom-0 z-10 box-border transition-transform duration-300 ease-out",
            controlsShellClass,
            controlsVisible ? "translate-y-0" : "pointer-events-none translate-y-full",
          ].join(" ")}
          style={{
            background: "linear-gradient(0deg, rgba(0, 0, 0, 0.6), transparent 96.97%)",
          }}
          onClick={(event) => event.stopPropagation()}
          onDoubleClick={(event) => event.stopPropagation()}
          onMouseEnter={clearHideTimer}
          onMouseLeave={scheduleControlsHide}
        >
          <div
            data-app-video-progress
            className={[
              "group/progress absolute z-20 h-3 outline-none",
              progressPositionClass,
            ].join(" ")}
          >
            <div className="pointer-events-none absolute left-0 right-0 top-1/2 h-0.5 -translate-y-1/2 overflow-visible rounded-full bg-white/30 transition-[height] duration-200 group-hover/progress:h-1 group-focus-within/progress:h-1">
              <span
                className="absolute inset-y-0 left-0 rounded-full bg-white"
                style={{ width: `${progressPercent}%` }}
              />
              <span
                className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border border-black/10 bg-white opacity-0 shadow-[0_0_2px_rgba(0,0,0,0.26)] transition-opacity group-hover/progress:opacity-100 group-focus-within/progress:opacity-100"
                style={{ left: `${progressPercent}%` }}
              />
            </div>
            <UiProps ids={{"aria-label":["common.m7dbd24c900ea"]}}><input
              aria-label="common.m7dbd24c900ea"
              type="range"
              min={0}
              max={duration > 0 ? duration : 0}
              step={0.01}
              value={clampAppVideoTime(currentTime, duration)}
              disabled={duration <= 0}
              tabIndex={controlsVisible ? 0 : -1}
              onChange={(event) => {
                const video = videoRef.current;
                if (!video) return;
                video.currentTime = clampAppVideoTime(Number(event.target.value), video.duration);
                setCurrentTime(video.currentTime);
              }}
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-default"
            /></UiProps>
          </div>

          <div className={["absolute flex items-center", controlsRowClass].join(" ")}>
            <UiProps ids={{"aria-label":["common.mc3396195e91c","common.m8d12fc0d4eb2"]}}><button
              type="button"
              className={[controlButtonClass, compact ? "mr-1" : "mr-[14px]"].join(" ")}
              aria-label={paused ? "common.mc3396195e91c" : "common.m8d12fc0d4eb2"}
              tabIndex={controlsVisible ? 0 : -1}
              onClick={togglePlayback}
            >
              {paused ? (
                <Play className={compact ? "h-4 w-4 translate-x-px" : "h-5 w-5 translate-x-px"} fill="currentColor" />
              ) : (
                <Pause className={compact ? "h-4 w-4" : "h-5 w-5"} fill="currentColor" />
              )}
            </button></UiProps>

            <span
              className={[
                "shrink-0 whitespace-nowrap text-center font-medium tabular-nums text-white [text-shadow:0_0_2px_rgba(0,0,0,0.2)]",
                compact ? "w-[52px] text-[10px]" : "w-[75px] text-xs",
              ].join(" ")}
            >
              {formatAppVideoTime(currentTime)} / {formatAppVideoTime(duration)}
            </span>

            <span className="min-w-2 flex-1" />

            <div
              className={[
                "relative flex shrink-0 items-center justify-center",
                compact ? "mr-1 h-7 min-w-6" : "mr-[18px] h-9 min-w-7",
              ].join(" ")}
              onMouseEnter={() => {
                clearHideTimer();
                setRateMenuOpen(true);
              }}
              onMouseLeave={() => setRateMenuOpen(false)}
              onBlurCapture={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                  setRateMenuOpen(false);
                }
              }}
            >
              <button
                type="button"
                className={["rounded-md px-1 font-medium text-white [text-shadow:0_0_4px_rgba(0,0,0,0.3)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80", compact ? "text-xs" : "text-sm"].join(" ")}
                aria-label={text("createDynamic.m1dc90c1d3cd0", { name: playbackRate })}
                aria-haspopup="menu"
                aria-expanded={rateMenuOpen}
                tabIndex={controlsVisible ? 0 : -1}
                onClick={() => setRateMenuOpen(true)}
              >
                {playbackRate === 1 ? (canvasPreview ? "1x" : <UiText id="common.m550201855541" />) : `${playbackRate}x`}
              </button>
              {rateMenuOpen ? (
                <UiProps ids={{"aria-label":["common.mc114a632b201"]}}><div
                  data-app-video-rate-menu
                  role="menu"
                  aria-label="common.mc114a632b201"
                  className={[
                    "absolute left-1/2 z-30 -translate-x-1/2 overflow-hidden bg-[#333] shadow-[0_8px_24px_rgba(0,0,0,0.3)]",
                    compact ? "w-10 rounded-md py-1" : "w-[54px] rounded-lg py-2",
                    compact ? "bottom-7" : "bottom-9",
                  ].join(" ")}
                >
                  {[...APP_VIDEO_PLAYBACK_RATES].reverse().map((rate) => (
                    <button
                      key={rate}
                      type="button"
                      role="menuitemradio"
                      aria-checked={playbackRate === rate}
                      className={[
                        "block w-full text-center transition-colors hover:text-white focus-visible:outline-none focus-visible:text-white",
                        compact ? "h-6 text-[10px]" : "h-9 text-xs",
                        playbackRate === rate ? "text-white" : "text-white/60",
                      ].join(" ")}
                      onClick={() => {
                        const video = videoRef.current;
                        if (!video) return;
                        video.playbackRate = rate;
                        setRateMenuOpen(false);
                      }}
                    >
                      {rate}x
                    </button>
                  ))}
                </div></UiProps>
              ) : null}
            </div>

            {!canvasPreview ? <div
              className={[
                "group/volume relative flex shrink-0 items-center justify-center",
                compact ? "mr-1 h-7 w-7" : "mr-[18px] h-9 w-9",
              ].join(" ")}
              onMouseEnter={clearHideTimer}
              onMouseLeave={scheduleControlsHide}
            >
              <div
                data-app-video-volume-popover
                className={[
                  "invisible absolute left-1/2 z-30 flex -translate-x-1/2 items-center justify-center bg-[#333] opacity-0 shadow-[0_8px_24px_rgba(0,0,0,0.3)] transition group-hover/volume:visible group-hover/volume:opacity-100 group-focus-within/volume:visible group-focus-within/volume:opacity-100",
                  compact ? "h-16 w-5 rounded-md" : "h-20 w-6 rounded-lg",
                  compact ? "bottom-7" : "bottom-9",
                ].join(" ")}
              >
                <UiProps ids={{"aria-label":["common.m8bf8b9780d34"]}}><input
                  aria-label="common.m8bf8b9780d34"
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={muted ? 0 : volume}
                  onChange={(event) => {
                    const video = videoRef.current;
                    if (!video) return;
                    const nextVolume = Number(event.target.value);
                    video.volume = nextVolume;
                    video.muted = nextVolume === 0;
                  }}
                  className={[
                    "cursor-pointer appearance-none rounded-full bg-white/45",
                    "[&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-transparent",
                    "[&::-webkit-slider-thumb]:h-2.5 [&::-webkit-slider-thumb]:w-2.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white",
                    "[&::-moz-range-track]:rounded-full [&::-moz-range-track]:bg-transparent",
                    "[&::-moz-range-thumb]:h-2.5 [&::-moz-range-thumb]:w-2.5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-white",
                    compact ? "h-12 w-1" : "h-16 w-1",
                  ].join(" ")}
                  style={{ writingMode: "vertical-lr", direction: "rtl" }}
                /></UiProps>
              </div>
              <UiProps ids={{"aria-label":["common.m8d01732e7477","common.m7db2e189ecb0"]}}><button
                type="button"
                className={controlButtonClass}
                aria-label={muted || volume === 0 ? "common.m8d01732e7477" : "common.m7db2e189ecb0"}
                tabIndex={controlsVisible ? 0 : -1}
                onClick={toggleMuted}
              >
                {muted || volume === 0 ? (
                  <VolumeX className={compact ? "h-4 w-4" : "h-6 w-6"} />
                ) : (
                  <Volume2 className={compact ? "h-4 w-4" : "h-6 w-6"} />
                )}
              </button></UiProps>
            </div> : null}

            {canPictureInPicture && !compact && !canvasPreview ? (
              <UiProps ids={{"aria-label":["common.m8fb522c9ce1b","common.m850875a7534d"]}}><button
                type="button"
                className={[controlButtonClass, compact ? "mr-1" : "mr-[18px]"].join(" ")}
                aria-label={pictureInPicture ? "common.m8fb522c9ce1b" : "common.m850875a7534d"}
                tabIndex={controlsVisible ? 0 : -1}
                onClick={() => void togglePictureInPicture()}
              >
                <PictureInPicture2 className="h-6 w-6" />
              </button></UiProps>
            ) : null}

            {canFullscreen ? (
              <UiProps ids={{"aria-label":["common.m0f1505b6ad3f","common.m22ea3f47fee8"]}}><button
                type="button"
                className={controlButtonClass}
                aria-label={fullscreen ? "common.m0f1505b6ad3f" : "common.m22ea3f47fee8"}
                tabIndex={controlsVisible ? 0 : -1}
                onClick={() => void toggleFullscreen()}
              >
                <Maximize className={compact ? "h-4 w-4" : "h-6 w-6"} />
              </button></UiProps>
            ) : null}
            {onCaptureFrame ? (
              <VideoFrameMenu
                open={frameMenuOpen}
                onOpenChange={setFrameMenuOpen}
                busy={frameCaptureBusy}
                disabled={failed || duration <= 0}
                visible={controlsVisible}
                compact={compact}
                buttonClassName={controlButtonClass}
                onSelect={(mode) => {
                  if (videoRef.current) onCaptureFrame(videoRef.current, mode);
                }}
              />
            ) : null}
          </div>
        </div>
      </div></UiProps>
    );
  },
);
