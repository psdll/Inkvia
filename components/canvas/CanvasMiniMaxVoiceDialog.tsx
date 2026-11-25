"use client";
import { UiText, UiProps, useUiLocale } from "@/i18n/ui";


import * as React from "react";
import { createBrowserUuid } from "@/lib/browser/random-uuid";
import { createPortal } from "react-dom";
import {
  AudioWaveform,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  Copy,
  Loader2,
  Mic2,
  MoreHorizontal,
  Pause,
  Pencil,
  Play,
  Search,
  SlidersHorizontal,
  Star,
  Trash2,
  X,
} from "lucide-react";

import { CanvasMiniMaxVoiceCloneDialog } from "@/components/canvas/CanvasMiniMaxVoiceCloneDialog";
import { CanvasMiniMaxVoiceFilterDialog } from "@/components/canvas/CanvasMiniMaxVoiceFilterDialog";
import {
  useCanvasMiniMaxVoiceLibrary,
} from "@/components/canvas/use-canvas-minimax-voices";
import { FrostedSelect } from "@/components/ui/frosted-select";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  EMPTY_CANVAS_VOICE_FILTERS,
  filterCanvasVoices,
  paginateCanvasVoices,
  paginationItems,
  type CanvasMiniMaxVoice,
  type CanvasVoiceFilters,
  type CanvasVoiceTab,
} from "@/lib/canvas/minimax-voice-library";

const LANGUAGE_LABELS: Record<string, string> = {
  zh: "中文(普通话)",
  yue: "粤语",
  en: "英文",
  ja: "日文",
  ko: "韩文",
  es: "西班牙语",
  pt: "葡萄牙语",
  fr: "法语",
  id: "印度尼西亚语",
  de: "德语",
  ru: "俄语",
  it: "意大利语",
  ar: "阿拉伯语",
  tr: "土耳其语",
  uk: "乌克兰语",
  nl: "荷兰语",
  vi: "越南语",
  multi: "多语种",
};

const VOICE_NOTICE_DURATION_MS = 3_000;

const GENDER_LABELS: Record<CanvasMiniMaxVoice["gender"], string> = {
  male: "男",
  female: "女",
  character: "角色",
  unknown: "未知",
};

export function CanvasMiniMaxVoiceDialog({
  open,
  value,
  model,
  onClose,
  onSelect,
  returnFocusRef,
}: {
  open: boolean;
  value: string;
  model: string;
  onClose: () => void;
  onSelect: (voice: CanvasMiniMaxVoice) => void;
  returnFocusRef?: React.RefObject<HTMLButtonElement>;
}) {
  const { text, error: uiError, label: uiLabel } = useUiLocale();
  const {
    voices,
    favoriteIds,
    errorMessage: libraryError,
    refetchVoices,
    setFavorite,
    renameVoice,
    deleteVoice,
  } = useCanvasMiniMaxVoiceLibrary();
  const [error, setError] = React.useState("");
  const [success, setSuccess] = React.useState("");
  const [tab, setTab] = React.useState<CanvasVoiceTab>("system");
  const [query, setQuery] = React.useState("");
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(20);
  const [jumpPage, setJumpPage] = React.useState("1");
  const [filters, setFilters] = React.useState<CanvasVoiceFilters>(
    EMPTY_CANVAS_VOICE_FILTERS,
  );
  const [filterOpen, setFilterOpen] = React.useState(false);
  const [cloneOpen, setCloneOpen] = React.useState(false);
  const [renameTarget, setRenameTarget] = React.useState<CanvasMiniMaxVoice | null>(null);
  const [renameName, setRenameName] = React.useState("");
  const [renameError, setRenameError] = React.useState("");
  const [deleteTarget, setDeleteTarget] = React.useState<CanvasMiniMaxVoice | null>(null);
  const [deleteError, setDeleteError] = React.useState("");
  const [moreMenu, setMoreMenu] = React.useState<{
    voice: CanvasMiniMaxVoice;
    top: number;
    left: number;
  } | null>(null);
  const [previewLoadingId, setPreviewLoadingId] = React.useState("");
  const [playingVoiceId, setPlayingVoiceId] = React.useState("");
  const previewAudioRef = React.useRef<HTMLAudioElement>(null);
  const closeButtonRef = React.useRef<HTMLButtonElement>(null);
  const filterButtonRef = React.useRef<HTMLButtonElement>(null);
  const titleId = React.useId();

  const closeMain = React.useCallback(() => {
    previewAudioRef.current?.pause();
    setPlayingVoiceId("");
    setMoreMenu(null);
    setRenameTarget(null);
    setDeleteTarget(null);
    onClose();
    queueMicrotask(() => returnFocusRef?.current?.focus());
  }, [onClose, returnFocusRef]);

  React.useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    requestAnimationFrame(() => closeButtonRef.current?.focus());
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  React.useEffect(() => {
    if (!open) {
      previewAudioRef.current?.pause();
      setPlayingVoiceId("");
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || filterOpen || cloneOpen || renameTarget || deleteTarget) return;
      if (moreMenu) {
        setMoreMenu(null);
        return;
      }
      closeMain();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [cloneOpen, closeMain, filterOpen, moreMenu, open, renameTarget, deleteTarget]);

  React.useEffect(() => {
    setPage(1);
    setJumpPage("1");
  }, [filters, pageSize, query, tab]);

  React.useEffect(() => {
    if (!success) return;
    const timeout = window.setTimeout(
      () => setSuccess(""),
      VOICE_NOTICE_DURATION_MS,
    );
    return () => window.clearTimeout(timeout);
  }, [success]);

  React.useEffect(() => {
    if (!moreMenu) return;
    const close = (event?: Event) => {
      if (
        event?.target instanceof Element &&
        event.target.closest(".canvas-minimax-voice-more-menu")
      ) {
        return;
      }
      setMoreMenu(null);
    };
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    document.addEventListener("pointerdown", close);
    return () => {
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
      document.removeEventListener("pointerdown", close);
    };
  }, [moreMenu]);

  const playPreview = React.useCallback(async (voiceId: string, url: string) => {
    const audio = previewAudioRef.current;
    if (!audio) return;
    audio.pause();
    audio.src = url;
    await audio.play();
    setPlayingVoiceId(voiceId);
  }, []);

  const previewVoice = async (voice: CanvasMiniMaxVoice) => {
    const audio = previewAudioRef.current;
    if (playingVoiceId === voice.id && audio) {
      audio.pause();
      setPlayingVoiceId("");
      return;
    }
    setError("");
    setPreviewLoadingId(voice.id);
    try {
      const response = await fetch("/api/canvas/speech/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestKey: createBrowserUuid(),
          model,
          voiceId: voice.id,
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.success || !payload?.outputPath) {
        throw new Error(payload?.error || "音色试听生成失败");
      }
      await playPreview(voice.id, String(payload.outputPath));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : text("workspaceFollowup.mb99415d23815"));
    } finally {
      setPreviewLoadingId("");
    }
  };

  const filtered = filterCanvasVoices({
    voices,
    tab,
    query,
    favoriteIds,
    filters,
  });
  const pagination = paginateCanvasVoices(filtered, page, pageSize);
  const goToPage = (next: number) => {
    const normalized = Math.min(pagination.pageCount, Math.max(1, next));
    setPage(normalized);
    setJumpPage(String(normalized));
  };
  const applyJumpPage = () =>
    goToPage(Math.trunc(Number(jumpPage)) || 1);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="canvas-minimax-voice-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) closeMain();
      }}
    >
      <section
        className="canvas-minimax-voice-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <audio
          ref={previewAudioRef}
          className="hidden"
          onEnded={() => setPlayingVoiceId("")}
          onError={() => {
            setPlayingVoiceId("");
            setError("音色试听播放失败");
          }}
        />
        <header className="canvas-minimax-voice-header">
          <h2 id={titleId}><UiText id="canvas.mf59a1ecfa906" /></h2>
          <UiProps ids={{"aria-label":["canvas.m246e347b51b9"]}}><button
            ref={closeButtonRef}
            type="button"
            aria-label="canvas.m246e347b51b9"
            onClick={closeMain}
          >
            <X aria-hidden="true" />
          </button></UiProps>
        </header>

        <div className="canvas-minimax-voice-toolbar">
          <div className="canvas-minimax-voice-tabs">
            {(
              [
                ["system", "音色库"],
                ["mine", "我的音色"],
                ["favorites", "收藏音色"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                aria-pressed={tab === key}
                onClick={() => {
                  setTab(key);
                  setQuery("");
                  setFilters(EMPTY_CANVAS_VOICE_FILTERS);
                  setMoreMenu(null);
                  setFilterOpen(false);
                  previewAudioRef.current?.pause();
                  setPlayingVoiceId("");
                }}
              >
                {label}
              </button>
            ))}
          </div>
          {tab === "mine" && <button
            type="button"
            className="canvas-minimax-voice-clone-button"
            aria-haspopup="dialog"
            onClick={() => {
              setCloneOpen(true);
              setError("");
              setSuccess("");
            }}
          >
            <Mic2 aria-hidden="true" /><UiText id="canvas.mc0d8a2c5e363" /></button>}
          <label className="canvas-minimax-voice-search">
            <Search aria-hidden="true" />
            <UiProps ids={{"placeholder":["canvas.meab17fa71173","canvas.m99adc4d3672e","canvas.m7b3bc6e622eb"],"aria-label":["canvas.meab17fa71173","canvas.m99adc4d3672e","canvas.m7b3bc6e622eb"]}}><input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={tab === "mine" ? "canvas.meab17fa71173" : tab === "favorites" ? "canvas.m99adc4d3672e" : "canvas.m7b3bc6e622eb"}
              aria-label={tab === "mine" ? "canvas.meab17fa71173" : tab === "favorites" ? "canvas.m99adc4d3672e" : "canvas.m7b3bc6e622eb"}
            /></UiProps>
          </label>
          {tab !== "mine" && <button
            ref={filterButtonRef}
            type="button"
            className="canvas-minimax-voice-filter-button"
            aria-haspopup="dialog"
            onClick={() => setFilterOpen(true)}
          >
            <SlidersHorizontal aria-hidden="true" /><UiText id="canvas.mb5f15473fdc0" /></button>}
        </div>

        <div className="canvas-minimax-voice-list" role="listbox">
          {tab === "mine" && (
            <p className="mb-3 text-xs text-[var(--app-muted)]"><UiText id="canvas.m4193295d8cd4" /></p>
          )}
          {error || libraryError ? (
            <div className="canvas-minimax-voice-error" role="status">
              {uiError(error || libraryError)}
            </div>
          ) : null}
          {filtered.length === 0 ? (
            <div className="canvas-minimax-voice-empty">
              {tab === "mine"
                ? <UiText id="canvas.m6da3417ab7b7" />
                : <UiText id="canvas.m51ff3e893332" />}
            </div>
          ) : null}
          <div className="canvas-minimax-voice-rows">
            {pagination.items.map((voice) => {
              const selected = voice.id === value;
              const favorite = favoriteIds.has(voice.id);
              const previewLoading = previewLoadingId === voice.id;
              const playing = playingVoiceId === voice.id;
              return (
                <div
                  key={`${voice.source}:${voice.id}`}
                  className="canvas-minimax-voice-row"
                  role="option"
                  aria-selected={selected}
                >
                  <button
                    type="button"
                    className="canvas-minimax-voice-preview-button"
                    aria-label={`${playing ? text("workspaceFollowup.m8d12fc0d4eb2") : text("workspaceFollowup.m7f0a0fda741c")}${voice.name}`}
                    disabled={Boolean(previewLoadingId) && !previewLoading}
                    onClick={() => void previewVoice(voice)}
                  >
                    {previewLoading ? (
                      <Loader2 className="animate-spin" aria-hidden="true" />
                    ) : playing ? (
                      <Pause aria-hidden="true" />
                    ) : (
                      <>
                        <AudioWaveform
                          className="is-waveform"
                          aria-hidden="true"
                        />
                        <Play className="is-play" aria-hidden="true" />
                      </>
                    )}
                  </button>
                  <div className="canvas-minimax-voice-name">{voice.name}</div>
                  <div className="canvas-minimax-voice-meta">
                    <span>
                      {uiLabel(LANGUAGE_LABELS[voice.language || "multi"] ||
                        voice.language ||
                        LANGUAGE_LABELS.multi)}
                    </span>
                    <span>{uiLabel(GENDER_LABELS[voice.gender])}</span>
                  </div>
                  <button
                    type="button"
                    className="canvas-minimax-voice-select-button"
                    disabled={selected}
                    onClick={() => {
                      onSelect(voice);
                      closeMain();
                    }}
                  >
                    {selected ? <UiText id="canvas.m7ecf1cde6486" /> : <UiText id="canvas.mc11330b85234" />}
                  </button>
                  <UiProps ids={{"aria-label":["canvas.mdca60869e7d2","canvas.m92118bfec471"]}}><button
                    type="button"
                    className="canvas-minimax-voice-icon-button"
                    aria-label={favorite ? "canvas.mdca60869e7d2" : "canvas.m92118bfec471"}
                    onClick={() =>
                      void setFavorite(voice.id, !favorite).catch((reason) =>
                        setError(
                          reason instanceof Error
                            ? reason.message
                            : "音色收藏更新失败",
                        ),
                      )
                    }
                  >
                    <Star fill={favorite ? "currentColor" : "none"} aria-hidden="true" />
                  </button></UiProps>
                  {voice.source === "system" || voice.canRename || voice.canDelete ? (
                    <button
                      type="button"
                      className="canvas-minimax-voice-icon-button"
                      aria-label={text("workspaceFollowup.mbec174e7f5dd", { v0: voice.name })}
                      onClick={(event) => {
                        const rect = event.currentTarget.getBoundingClientRect();
                        setMoreMenu({
                          voice,
                          top: rect.bottom + 6,
                          left: Math.max(8, rect.right - 134),
                        });
                      }}
                    >
                      <MoreHorizontal aria-hidden="true" />
                    </button>
                  ) : (
                    <span className="canvas-minimax-voice-icon-spacer" />
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <footer className="canvas-minimax-voice-footer">
          <div className="canvas-minimax-voice-pages">
            <UiProps ids={{"aria-label":["canvas.mc9b9ae7a6144"]}}><button
              type="button"
              aria-label="canvas.mc9b9ae7a6144"
              disabled={pagination.page <= 1}
              onClick={() => goToPage(pagination.page - 1)}
            >
              <ChevronLeft aria-hidden="true" />
            </button></UiProps>
            {paginationItems(pagination.page, pagination.pageCount).map(
              (item, index) =>
                item === "ellipsis" ? (
                  <span key={`ellipsis-${index}`} className="is-ellipsis">
                    …
                  </span>
                ) : (
                  <button
                    key={item}
                    type="button"
                    aria-current={item === pagination.page ? "page" : undefined}
                    onClick={() => goToPage(item)}
                  >
                    {item}
                  </button>
                ),
            )}
            <UiProps ids={{"aria-label":["canvas.m8a8542f69648"]}}><button
              type="button"
              aria-label="canvas.m8a8542f69648"
              disabled={pagination.page >= pagination.pageCount}
              onClick={() => goToPage(pagination.page + 1)}
            >
              <ChevronRight aria-hidden="true" />
            </button></UiProps>
          </div>
          <FrostedSelect
            value={String(pageSize)}
            onChange={(next) => setPageSize(Number(next))}
            options={[
              { value: "10", label: text("workspaceFollowup.m2998153ee61d") },
              { value: "20", label: text("workspaceFollowup.mb5a2124c964e") },
              { value: "50", label: text("workspaceFollowup.mb26687371107") },
            ]}
            variant="canvas"
            compact
            side="top"
            showLeading={false}
            showOptionLeading={false}
            menuWidth={108}
            menuMaxHeight={110}
            optionHeight={34}
            ariaLabel={text("workspaceFollowup.m940a168911ad")}
            className="canvas-minimax-voice-page-size"
            menuClassName="canvas-minimax-voice-page-size-menu"
          />
          <label className="canvas-minimax-voice-jump">
            <span><UiText id="canvas.m83954f3e3c76" /></span>
            <UiProps ids={{"aria-label":["canvas.me6944bbd76f0"]}}><input
              value={jumpPage}
              inputMode="numeric"
              aria-label="canvas.me6944bbd76f0"
              onChange={(event) =>
                setJumpPage(event.target.value.replace(/\D/g, ""))
              }
              onBlur={applyJumpPage}
              onKeyDown={(event) => {
                if (event.key === "Enter") applyJumpPage();
              }}
            /></UiProps>
            <span><UiText id="canvas.md24d3c99460c" /></span>
          </label>
          <span className="canvas-minimax-voice-total"><UiText id="canvas.m2428420e407f" />{pagination.total}<UiText id="canvas.m6fb2840d568a" /></span>
        </footer>

        <CanvasMiniMaxVoiceFilterDialog
          open={filterOpen}
          voices={voices}
          applied={filters}
          onApply={setFilters}
          onClose={() => setFilterOpen(false)}
          returnFocusRef={filterButtonRef}
        />
        <CanvasMiniMaxVoiceCloneDialog
          open={cloneOpen}
          model={model}
          onClose={() => setCloneOpen(false)}
          onCreated={async (voiceId, warning) => {
            setCloneOpen(false);
            setTab("mine");
            setQuery("");
            setFilters(EMPTY_CANVAS_VOICE_FILTERS);
            setPage(1);
            setJumpPage("1");
            const result = await refetchVoices().catch(() => null);
            if (warning || !result?.data?.voices.some(voice => voice.id === voiceId)) {
              setError(warning || `音色已生成，列表暂未同步。请保留音色 ID：${voiceId}`);
            } else {
              setError("");
              setSuccess("音色复刻成功，已加入我的音色");
            }
          }}
        />
        <UiProps ids={{"title":["canvas.me478ee975428"],"confirmText":["canvas.ma759dd2529f1"]}}><ConfirmDialog
          open={Boolean(renameTarget)}
          zIndex={1060}
          darkSolidSurface
          title="canvas.me478ee975428"
          confirmText="canvas.ma759dd2529f1"
          confirmDisabled={!renameName.trim()}
          onClose={() => setRenameTarget(null)}
          onConfirm={async () => {
            if (!renameTarget) return false;
            setRenameError("");
            try {
              await renameVoice(renameTarget.id, renameName.trim());
              setSuccess("音色名称已更新");
            } catch (reason) {
              setRenameError(reason instanceof Error ? reason.message : "音色改名失败");
              return false;
            }
          }}
        >
          <UiProps ids={{"aria-label":["canvas.ma5bd8f0c25fd"]}}><input
            aria-label="canvas.ma5bd8f0c25fd"
            maxLength={120}
            value={renameName}
            onChange={(event) => setRenameName(event.target.value)}
            className="w-full rounded-xl border border-[var(--border)] bg-[var(--panel-2)] px-3 py-2 text-sm text-[var(--app-fg)]"
          /></UiProps>
          {renameError && <p className="mt-2 text-sm text-red-400" role="alert">{uiError(renameError)}</p>}
        </ConfirmDialog></UiProps>
        <UiProps ids={{"title":["canvas.m8f9e2f3eb31e"],"confirmText":["canvas.ma3ea3c17b401"]}}><ConfirmDialog
          open={Boolean(deleteTarget)}
          zIndex={1060}
          darkSolidSurface
          danger
          title="canvas.m8f9e2f3eb31e"
          description={text("workspaceFollowup.m742ba77b9dfa", { v0: deleteTarget?.name || "" })}
          confirmText="canvas.ma3ea3c17b401"
          onClose={() => setDeleteTarget(null)}
          onConfirm={async () => {
            if (!deleteTarget) return false;
            setDeleteError("");
            try {
              await deleteVoice(deleteTarget.id);
              previewAudioRef.current?.pause();
              setPlayingVoiceId("");
              setError("");
              setSuccess("音色已删除");
            } catch (reason) {
              setDeleteError(reason instanceof Error ? reason.message : "音色删除失败");
              return false;
            }
          }}
        >
          {deleteError && <p className="text-sm text-red-400" role="alert">{uiError(deleteError)}</p>}
        </ConfirmDialog></UiProps>
        {moreMenu
          ? createPortal(
              <div
                className="canvas-minimax-voice-more-menu"
                style={{ top: moreMenu.top, left: moreMenu.left }}
                role="menu"
              >
                {moreMenu.voice.canRename && (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setRenameTarget(moreMenu.voice);
                      setRenameName(moreMenu.voice.name);
                      setRenameError("");
                      setMoreMenu(null);
                    }}
                  >
                    <Pencil aria-hidden="true" /><UiText id="canvas.m88f4625eade2" /></button>
                )}
                {moreMenu.voice.canDelete && (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setDeleteTarget(moreMenu.voice);
                      setDeleteError("");
                      setMoreMenu(null);
                    }}
                  >
                    <Trash2 aria-hidden="true" /><UiText id="canvas.m8f9e2f3eb31e" /></button>
                )}
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    void navigator.clipboard
                      .writeText(moreMenu.voice.id)
                      .then(() => setSuccess("Voice ID 已复制"))
                      .catch(() => setError("Voice ID 复制失败"));
                    setMoreMenu(null);
                  }}
                >
                  <Copy aria-hidden="true" /><UiText id="canvas.m073c5b9bf7f7" /></button>
              </div>,
              document.body,
            )
          : null}
      </section>
      {success ? (
        <div
          className="canvas-minimax-voice-success-toast"
          role="status"
          aria-live="polite"
        >
          <CircleCheck aria-hidden="true" />
          <span>{uiLabel(success)}</span>
          <UiProps ids={{"aria-label":["canvas.md301bc125833"]}}><button
            type="button"
            aria-label="canvas.md301bc125833"
            onClick={() => setSuccess("")}
          >
            <X aria-hidden="true" />
          </button></UiProps>
        </div>
      ) : null}
    </div>,
    document.body,
  );
}
