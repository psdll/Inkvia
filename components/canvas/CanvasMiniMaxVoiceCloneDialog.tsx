"use client";
import { UiText, UiProps, useUiLocale } from "@/i18n/ui";


import * as React from "react";
import { createPortal } from "react-dom";
import { Loader2, Mic2, RefreshCw, Square, Upload, X } from "lucide-react";

import { usePcmWavRecorder } from "@/components/canvas/use-pcm-wav-recorder";
import { prepareVoiceCloneUpload } from "@/lib/canvas/voice-clone-upload";
import {
  CANVAS_CLONE_MAX_SECONDS,
  CANVAS_CLONE_MIN_SECONDS,
} from "@/lib/canvas/pcm-wav";

const READING_PASSAGES = [
  "清晨的阳光落在窗边，我用自然平稳的声音读完这段文字，让每一个字都清楚、连贯而放松。",
  "今天的天气很舒适，微风穿过树叶，远处传来轻轻的鸟鸣，我慢慢讲述眼前宁静的画面。",
  "请保持正常的说话速度，不需要刻意提高音量，也不用模仿任何人，只要自然地完成这段朗读。",
  "傍晚时分，城市的灯光依次亮起，人们结束一天的工作，带着轻松的心情踏上回家的路。",
  "一本好书能够带我们认识不同的世界，也能让忙碌的时刻安静下来，重新感受思考的乐趣。",
  "沿着熟悉的小路向前走，空气里带着淡淡的花香，我停下脚步，认真听见周围细微的声音。",
] as const;

function formatDuration(value: number) {
  const seconds = Math.max(0, Math.min(300, Math.floor(value)));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(
    seconds % 60,
  ).padStart(2, "0")}`;
}

export function CanvasMiniMaxVoiceCloneDialog({
  open,
  model,
  onCreated,
  onClose,
}: {
  open: boolean;
  model: string;
  onCreated: (voiceId: string, warning?: string) => Promise<void> | void;
  onClose: () => void;
}) {
  const { label: uiLabel } = useUiLocale();
  const {
    state: recorderState,
    elapsedSeconds,
    recordedFile,
    errorMessage,
    start,
    stop,
    reset,
  } = usePcmWavRecorder();
  const [passageIndex, setPassageIndex] = React.useState(0);
  const [consented, setConsented] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [message, setMessage] = React.useState("");
  const [created, setCreated] = React.useState(false);
  const [source, setSource] = React.useState<"record" | "upload">("record");
  const [upload, setUpload] = React.useState<{
    file: File;
    durationSeconds: number;
  } | null>(null);
  const [preparing, setPreparing] = React.useState(false);
  const [uploadName, setUploadName] = React.useState("");
  const [dragging, setDragging] = React.useState(false);
  const dragDepthRef = React.useRef(0);
  const uploadVersionRef = React.useRef(0);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const closeRef = React.useRef<HTMLButtonElement>(null);
  const titleId = React.useId();

  const close = React.useCallback(() => {
    uploadVersionRef.current += 1;
    reset();
    onClose();
  }, [onClose, reset]);

  React.useEffect(() => {
    if (!open) return;
    reset();
    setConsented(false);
    setSubmitting(false);
    setMessage("");
    setCreated(false);
    setSource("record");
    setUpload(null);
    setUploadName("");
    setPreparing(false);
    setDragging(false);
    dragDepthRef.current = 0;
    requestAnimationFrame(() => closeRef.current?.focus());
    return () => { uploadVersionRef.current += 1; };
  }, [open, reset]);

  React.useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      close();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [close, open]);

  if (!open || typeof document === "undefined") return null;

  const sampleFile = source === "upload" ? upload?.file : recordedFile;
  const sampleDuration = source === "upload" ? upload?.durationSeconds ?? 0 : elapsedSeconds;
  const canGenerate =
    (source === "upload" || recorderState === "recorded") &&
    sampleDuration >= CANVAS_CLONE_MIN_SECONDS &&
    sampleDuration <= CANVAS_CLONE_MAX_SECONDS &&
    Boolean(sampleFile) &&
    consented &&
    !preparing &&
    !submitting;
  const recordingMessage =
    recorderState === "recorded" &&
    elapsedSeconds < CANVAS_CLONE_MIN_SECONDS
      ? "请继续录制，至少需要 10 秒"
      : errorMessage;

  const selectUpload = async (file: File) => {
    const version = ++uploadVersionRef.current;
    setUpload(null);
    setUploadName(file.name);
    setMessage("");
    setPreparing(true);
    try {
      const result = await prepareVoiceCloneUpload(file);
      if (version === uploadVersionRef.current) setUpload(result);
    } catch (error) {
      if (version === uploadVersionRef.current) {
        setMessage(error instanceof Error ? error.message : "音频读取失败，请重新选择");
      }
    } finally {
      if (version === uploadVersionRef.current) setPreparing(false);
    }
  };

  const submit = async () => {
    if (!canGenerate || !sampleFile) return;
    setSubmitting(true);
    setMessage("");
    try {
      const form = new FormData();
      form.append("file", sampleFile);
      form.append("model", model);
      const response = await fetch("/api/canvas/speech/clone", {
        method: "POST",
        body: form,
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.success || !payload?.voiceId) {
        throw new Error(payload?.error || "音色复刻失败");
      }
      await onCreated(String(payload.voiceId), payload.warning);
      setCreated(true);
      setMessage(
        payload.warning || "音色已生成并保存到我的音色。请在 7 天内首次用于正式语音合成，否则 MiniMax 会删除该音色。",
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "音色复刻失败");
    } finally {
      setSubmitting(false);
    }
  };

  return createPortal(
    <div
      className="canvas-minimax-voice-secondary-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <section
        className="canvas-minimax-voice-clone-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="canvas-minimax-voice-secondary-header">
          <h3 id={titleId}><UiText id="canvas.mc0d8a2c5e363" /></h3>
          <UiProps ids={{"aria-label":["canvas.m2cf7a8f0e8d8"]}}><button ref={closeRef} type="button" aria-label="canvas.m2cf7a8f0e8d8" onClick={close}>
            <X aria-hidden="true" />
          </button></UiProps>
        </header>
        <div className="canvas-minimax-voice-clone-body">
          <UiProps ids={{"aria-label":["canvas.m6dd10126d180"]}}><div className="canvas-minimax-voice-source" role="group" aria-label="canvas.m6dd10126d180">
            {(["record", "upload"] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={source === value}
                disabled={submitting || created || recorderState === "recording" || recorderState === "requesting"}
                onClick={() => {
                  if (source === value) return;
                  uploadVersionRef.current += 1;
                  reset();
                  setSource(value);
                  setUpload(null);
                  setUploadName("");
                  setPreparing(false);
                  setDragging(false);
                  dragDepthRef.current = 0;
                  setMessage("");
                }}
              >
                {value === "record" ? <UiText id="canvas.m2377044237fb" /> : <UiText id="canvas.m4660089610fc" />}
              </button>
            ))}
          </div></UiProps>
          {source === "record" ? (
            <>
              <div className="canvas-minimax-voice-clone-heading">
                <div>
                  <strong><UiText id="canvas.md329f053614c" /></strong>
                  <span><UiText id="canvas.m81c07a928372" /></span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setPassageIndex((current) => (current + 1) % READING_PASSAGES.length);
                    setMessage("");
                  }}
                >
                  <RefreshCw aria-hidden="true" /><UiText id="canvas.m0e06b00729c5" /></button>
              </div>
              <p className="canvas-minimax-voice-reading-text">
                {READING_PASSAGES[passageIndex]}
              </p>
              <div className="canvas-minimax-voice-recording-row">
                <button
                  type="button"
                  className="canvas-minimax-voice-record-button"
                  data-recording={recorderState === "recording" || undefined}
                  disabled={recorderState === "requesting" || submitting || created}
                  onClick={() => {
                    setMessage("");
                    if (recorderState === "recording") void stop();
                    else void start();
                  }}
                >
                  {recorderState === "requesting" ? (
                    <Loader2 className="animate-spin" aria-hidden="true" />
                  ) : recorderState === "recording" ? (
                    <Square aria-hidden="true" />
                  ) : (
                    <Mic2 aria-hidden="true" />
                  )}
                  {recorderState === "recording"
                    ? <UiText id="canvas.m84e3135a0e30" />
                    : recorderState === "recorded"
                      ? <UiText id="canvas.me869e0818877" />
                      : <UiText id="canvas.mee9247035880" />}
                </button>
                <span className="canvas-minimax-voice-recording-time">
                  {formatDuration(elapsedSeconds)} / 05:00
                </span>
              </div>
            </>
          ) : (
            <>
              <div className="canvas-minimax-voice-clone-heading">
                <div>
                  <strong><UiText id="canvas.mfff1c9128c78" /></strong>
                  <span><UiText id="canvas.mc861669b385a" /></span>
                </div>
              </div>
              <div
                className="canvas-minimax-voice-upload"
                data-dragging={dragging || undefined}
                onDragEnter={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  if (preparing || submitting || created || !Array.from(event.dataTransfer.types).includes("Files")) return;
                  dragDepthRef.current += 1;
                  setDragging(true);
                }}
                onDragOver={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  event.dataTransfer.dropEffect = preparing || submitting || created ? "none" : "copy";
                }}
                onDragLeave={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
                  if (!dragDepthRef.current) setDragging(false);
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  dragDepthRef.current = 0;
                  setDragging(false);
                  if (preparing || submitting || created) return;
                  const files = event.dataTransfer.files;
                  if (files.length > 1) {
                    setUpload(null);
                    setUploadName("");
                    setMessage("一次只能上传一个音频文件");
                    return;
                  }
                  if (files[0]) void selectUpload(files[0]);
                }}
              >
                <UiProps ids={{"aria-label":["canvas.maac2dee0f390"]}}><input
                  ref={fileInputRef}
                  type="file"
                  accept=".mp3,.m4a,.wav,audio/mpeg,audio/mp4,audio/wav,audio/x-wav"
                  aria-label="canvas.maac2dee0f390"
                  hidden
                  disabled={preparing || submitting || created}
                  onChange={(event) => {
                    const file = event.currentTarget.files?.[0];
                    event.currentTarget.value = "";
                    if (file) void selectUpload(file);
                  }}
                /></UiProps>
                <button
                  type="button"
                  className="canvas-minimax-voice-record-button"
                  disabled={preparing || submitting || created}
                  onClick={() => fileInputRef.current?.click()}
                >
                  {preparing ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Upload aria-hidden="true" />}
                  {preparing ? <UiText id="canvas.m154ef90ae17d" /> : uploadName ? <UiText id="canvas.mb21f363123e0" /> : <UiText id="canvas.ma7d49abed19c" />}
                </button>
                {uploadName ? <span className="canvas-minimax-voice-upload-name" title={uploadName}>
                  {uploadName}{upload ? ` · ${formatDuration(upload.durationSeconds)}` : ""}
                </span> : <span><UiText id="canvas.m9e4dfa878b3c" /></span>}
              </div>
            </>
          )}
          <div
            className="canvas-minimax-voice-recording-message"
            role={source === "upload" && message && !created ? "alert" : "status"}
            data-error={source === "upload" && Boolean(message) && !created || undefined}
          >
            {uiLabel(message || (source === "record" ? recordingMessage : ""))}
          </div>
          <label className="canvas-minimax-voice-consent">
            <input
              type="checkbox"
              checked={consented}
              disabled={submitting || created}
              onChange={(event) => setConsented(event.target.checked)}
            />
            <span><UiText id="canvas.md7ce794d0b86" /><a
                href="https://platform.minimaxi.com/docs/guides/speech-voice-clone"
                target="_blank"
                rel="noreferrer"
              ><UiText id="canvas.m9b1ed56b484c" /></a><UiText id="canvas.m87a007851cdc" /></span>
          </label>
        </div>
        <footer className="canvas-minimax-voice-secondary-footer">
          <button type="button" className="is-secondary" onClick={close}>
            {created ? <UiText id="canvas.m026963d66ea8" /> : <UiText id="canvas.m2cd0f3be8738" />}
          </button>
          {!created ? (
            <button
              type="button"
              className="is-primary"
              disabled={!canGenerate}
              onClick={() => void submit()}
            >
              {submitting ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}<UiText id="canvas.mdae59f6f1acf" /></button>
          ) : null}
        </footer>
      </section>
    </div>,
    document.body,
  );
}
