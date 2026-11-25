"use client";
import { UiText, UiProps } from "@/i18n/ui";


import * as React from "react";
import { Trash2, Upload, ZoomIn } from "lucide-react";
import { useAuth } from "@/components/auth/AuthProvider";
import { MediaLightbox } from "@/components/ui/media-lightbox";
import { buildMediaProxyUrl } from "@/lib/media-url";
import {
  MEDIA_LIBRARY_DRAG_ITEMS_TYPE,
  readMediaLibraryDragItems,
} from "@/lib/media-library-drag";

export type UploadDropzoneProps = {
  title: string;
  desc?: string;
  accept: string;
  file: File | null;
  url?: string | null;
  onFileChange: (file: File | null) => void;
  onUrlChange?: (url: string | null) => void;
  className?: string;
  variant?: "card" | "inline";
  previewSize?: "square" | "video";
};

function guessKindFromFile(file: File | null) {
  if (!file) return "image" as const;
  if (file.type.startsWith("video/")) return "video" as const;
  const name = file.name.toLowerCase();
  if (/\.(mp4|mov|webm|mkv|m4v)$/i.test(name)) return "video" as const;
  return "image" as const;
}

function guessKindFromUrl(url: string | null | undefined) {
  const u = normalizePreviewUrl(String(url || "")).toLowerCase();
  if (!u) return "image" as const;
  if (/\.(mp4|mov|webm|mkv|m4v)(\?|#|$)/i.test(u)) return "video" as const;
  return "image" as const;
}

function normalizePreviewUrl(raw: string) {
  const text = String(raw || "").trim();
  if (!text) return "";
  if (text === "null" || text === "undefined") return "";
  const safeText = text.replaceAll("\\", "/");
  const unwrapProxy = (value: string) => {
    if (typeof window === "undefined") return value;
    try {
      const u = new URL(value, window.location.origin);
      if (u.origin === window.location.origin && u.pathname === "/api/media-proxy") {
        const source = String(u.searchParams.get("url") || "").trim();
        if (source) return source;
      }
      return value;
    } catch {
      return value;
    }
  };
  const unwrapped = unwrapProxy(safeText);
  if (unwrapped.startsWith("/uploads/")) return unwrapped;
  if (unwrapped.startsWith("uploads/")) return `/${unwrapped}`;
  if (typeof window === "undefined") return unwrapped;
  try {
    const u = new URL(unwrapped, window.location.origin);
    if (u.origin === window.location.origin && u.pathname.startsWith("/uploads/")) {
      return `${u.pathname}${u.search}${u.hash}`;
    }
    return u.toString();
  } catch {
    return unwrapped;
  }
}

function normalizeDroppedUrl(raw: string) {
  const text = String(raw || "").trim();
  if (!text) return "";
  if (text === "null" || text === "undefined") return "";
  const safeText = text.replaceAll("\\", "/");
  const unwrapProxy = (value: string) => {
    if (typeof window === "undefined") return value;
    try {
      const u = new URL(value, window.location.origin);
      if (u.origin === window.location.origin && u.pathname === "/api/media-proxy") {
        const source = String(u.searchParams.get("url") || "").trim();
        if (source) return source;
      }
      return value;
    } catch {
      return value;
    }
  };
  const unwrapped = unwrapProxy(safeText);
  if (unwrapped.startsWith("/uploads/")) return unwrapped;
  if (unwrapped.startsWith("uploads/")) return `/${unwrapped}`;
  if (typeof window === "undefined") return unwrapped;
  try {
    const u = new URL(unwrapped, window.location.origin);
    if (u.origin === window.location.origin && u.pathname.startsWith("/uploads/")) {
      return `${u.pathname}${u.search}${u.hash}`;
    }
    return u.toString();
  } catch {
    return unwrapped;
  }
}

function looksLikeVideoUrl(src: string) {
  const s = String(src || "").toLowerCase();
  return /\.(mp4|mov|webm|mkv|m4v)(\?|#|$)/i.test(s);
}

function extByMime(type: string) {
  const t = String(type || "").toLowerCase();
  if (t === "image/png") return "png";
  if (t === "image/webp") return "webp";
  if (t === "image/gif") return "gif";
  if (t === "image/bmp") return "bmp";
  if (t === "image/avif") return "avif";
  if (t === "image/jpeg" || t === "image/jpg") return "jpg";
  if (t === "video/mp4") return "mp4";
  if (t === "video/webm") return "webm";
  if (t === "video/quicktime") return "mov";
  if (t === "video/x-matroska") return "mkv";
  return "";
}

export function UploadDropzone({
  title,
  desc,
  accept,
  file,
  url,
  onFileChange,
  onUrlChange,
  className,
  variant = "card",
  previewSize = "video"
}: UploadDropzoneProps) {
  const { user, openLoginModal } = useAuth();
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = React.useState(false);
  const [previewUrl, setPreviewUrl] = React.useState<string | null>(null);
  const [lightboxOpen, setLightboxOpen] = React.useState(false);

  const kind = file ? guessKindFromFile(file) : guessKindFromUrl(url);

  React.useEffect(() => {
    if (file) {
      const u = URL.createObjectURL(file);
      setPreviewUrl(u);
      return () => URL.revokeObjectURL(u);
    }
    const normalized = normalizePreviewUrl(url || "");
    setPreviewUrl(buildMediaProxyUrl(normalized) || null);
  }, [file, url]);

  const ensureCanUpload = React.useCallback(() => {
    if (user) return true;
    openLoginModal();
    return false;
  }, [openLoginModal, user]);

  const pick = () => {
    if (!ensureCanUpload()) return;
    inputRef.current?.click();
  };

  const setFromFileList = (files: FileList | null | undefined) => {
    if (!ensureCanUpload()) return;
    if (!files || files.length === 0) return;
    const f = files[0] || null;
    onFileChange(f);
    if (inputRef.current) inputRef.current.value = "";
  };

  const isFileDrag = (e: React.DragEvent) => {
    const types = Array.from(e.dataTransfer?.types || []);
    return types.includes("Files");
  };

  const isUrlDrag = (e: React.DragEvent) => {
    const types = Array.from(e.dataTransfer?.types || []);
    return (
      types.includes(MEDIA_LIBRARY_DRAG_ITEMS_TYPE) ||
      types.includes("application/x-media-library-url") ||
      types.includes("application/x-history-image-url") ||
      types.includes("application/x-history-media-url") ||
      types.includes("application/x-local-upload-path") ||
      types.includes("text/uri-list") ||
      types.includes("text/plain")
    );
  };

  const isSupportedDrag = (e: React.DragEvent) => isFileDrag(e) || isUrlDrag(e);

  const isUrlAccepted = (src: string) => {
    const specs = String(accept || "")
      .split(",")
      .map((x) => x.trim().toLowerCase())
      .filter(Boolean);
    if (!specs.length || specs.includes("*/*")) return true;
    const isVideo = looksLikeVideoUrl(src);
    const hasImageRule = specs.some((s) => s.startsWith("image/"));
    const hasVideoRule = specs.some((s) => s.startsWith("video/"));
    if (isVideo) return hasVideoRule;
    return hasImageRule || !hasVideoRule;
  };

  const readDroppedUrl = (e: React.DragEvent) => {
    const libraryItems = readMediaLibraryDragItems(e.dataTransfer);
    const groupedUrl = libraryItems[0]?.url;
    if (groupedUrl) return normalizeDroppedUrl(groupedUrl);
    const mediaLibraryUrl = e.dataTransfer.getData("application/x-media-library-url");
    if (mediaLibraryUrl) return normalizeDroppedUrl(mediaLibraryUrl);
    const localPath = e.dataTransfer.getData("application/x-local-upload-path");
    if (localPath) return normalizeDroppedUrl(localPath);
    const media = e.dataTransfer.getData("application/x-history-media-url");
    if (media) return normalizeDroppedUrl(media);
    const custom = e.dataTransfer.getData("application/x-history-image-url");
    if (custom) return normalizeDroppedUrl(custom);
    const uriList = e.dataTransfer.getData("text/uri-list");
    if (uriList) {
      const first = uriList
        .split(/\r?\n/)
        .map((x) => x.trim())
        .find((x) => x && !x.startsWith("#"));
      if (first) return normalizeDroppedUrl(first);
    }
    const plain = e.dataTransfer.getData("text/plain");
    if (plain) return normalizeDroppedUrl(plain);
    return "";
  };

  const convertDroppedUrlToFile = async (src: string) => {
    const normalized = normalizeDroppedUrl(src);
    if (!normalized || !isUrlAccepted(normalized)) return null;
    const isLocalUpload = normalized.startsWith("/uploads/");
    if (isLocalUpload) {
      const res = await fetch(normalized).catch(() => null);
      if (!res || !res.ok) return null;
      const blob = await res.blob().catch(() => null);
      if (!blob) return null;
      const mime = String(blob.type || "");
      const ext = extByMime(mime);
      const kindPrefix = mime.startsWith("video/") ? "dropped-video" : "dropped-image";
      const filename = `${kindPrefix}-${Date.now()}${ext ? `.${ext}` : ""}`;
      return new File([blob], filename, { type: mime || undefined });
    }
    const form = new FormData();
    form.set("sourceUrl", normalized);
    const res = await fetch("/api/assets/import", {
      method: "POST",
      body: form,
    }).catch(() => null);
    const json = (await res?.json().catch(() => null)) as any;
    const importedPath = String(json?.data?.localPath || "");
    if (!res || !res.ok || !importedPath) return null;
    const importedRes = await fetch(importedPath).catch(() => null);
    if (!importedRes || !importedRes.ok) return null;
    const blob = await importedRes.blob().catch(() => null);
    if (!blob) return null;
    const mime = String(blob.type || "");
    const ext = extByMime(mime);
    const kindPrefix = mime.startsWith("video/") ? "dropped-video" : "dropped-image";
    const filename = `${kindPrefix}-${Date.now()}${ext ? `.${ext}` : ""}`;
    return new File([blob], filename, { type: mime || undefined });
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (!ensureCanUpload()) return;
    if (isFileDrag(e)) {
      setFromFileList(e.dataTransfer.files);
      return;
    }
    if (!isUrlDrag(e)) return;
    const droppedUrl = readDroppedUrl(e);
    if (!droppedUrl) return;
    void convertDroppedUrlToFile(droppedUrl).then((f) => {
      if (!f) return;
      onFileChange(f);
      if (inputRef.current) inputRef.current.value = "";
    });
  };

  const onDelete = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onFileChange(null);
    onUrlChange?.(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  const onZoom = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!previewUrl) return;
    setLightboxOpen(true);
  };

  const base =
    variant === "inline"
      ? [
          "w-full rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] shadow-[var(--shadow-2)] p-3 flex gap-3 items-center",
          dragging ? "ring-2 ring-blue-500/25 border-blue-500/30 bg-[var(--panel-2)]" : ""
        ].join(" ")
      : [
          "relative w-full cursor-pointer overflow-hidden rounded-xl",
          previewSize === "square" ? "h-[clamp(180px,30dvh,280px)]" : "h-[clamp(180px,28dvh,260px)]"
        ].join(" ");

  const overlay =
    variant === "card"
      ? previewUrl
        ? dragging
          ? (
              <div className="absolute inset-0 border-2 border-dashed border-blue-500/70 bg-transparent transition-all duration-200" />
            )
          : null
        : (
            <div
              className={[
                "absolute inset-0 border-2 border-dashed border-[var(--border-2)] bg-[var(--panel-2)] flex flex-col items-center justify-center gap-4 transition-all duration-300",
                dragging ? "border-blue-500/60 bg-[var(--panel-3)]" : "group-hover:border-blue-500/45 group-hover:bg-[var(--panel-3)]"
              ].join(" ")}
            >
              <div className="w-16 h-16 bg-[var(--panel-bg)] rounded-full flex items-center justify-center shadow-[var(--shadow-2)] border border-[var(--border)] group-hover:scale-110 transition-transform">
                <Upload className="w-6 h-6 text-[var(--app-muted)] group-hover:text-blue-600" />
              </div>
              <div className="text-center space-y-1">
                <p className="text-sm font-medium text-[var(--app-fg)]"><UiText id="common.maadd89aae1ed" /></p>
                {desc ? <p className="text-xs text-[var(--app-muted)]">{desc}</p> : null}
              </div>
            </div>
          )
      : null;

  return (
    <>
      {variant === "card" ? (
        <div className={["flex flex-col group", className || ""].join(" ")}>
          <div className="flex justify-between items-center mb-3">
            <span className="text-xs font-bold text-[var(--app-muted)] tracking-wider">{title}</span>
          </div>
          <div
            className={base}
            role="button"
            tabIndex={0}
            onClick={pick}
            onDragEnter={(e) => {
              if (!isSupportedDrag(e)) return;
              e.preventDefault();
              setDragging(true);
            }}
            onDragOver={(e) => {
              if (!isSupportedDrag(e)) return;
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={(e) => {
              if (!isSupportedDrag(e)) return;
              e.preventDefault();
              setDragging(false);
            }}
            onDrop={onDrop}
          >
            {previewUrl ? (
              <div className="absolute inset-0 bg-[var(--input-bg)] flex items-center justify-center">
                {kind === "video" ? (
                  <video src={previewUrl} className="max-w-full max-h-full object-contain" muted playsInline />
                ) : (
                  <img src={previewUrl} alt={title} className="max-w-full max-h-full object-contain" />
                )}
              </div>
            ) : null}
            {overlay}

            {previewUrl ? (
              <div className="absolute top-2 right-2 flex items-center gap-2 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto transition">
                <UiProps ids={{"aria-label":["common.m80f8fbcfa011"]}}><button
                  type="button"
                  onClick={onZoom}
                  className="h-8 w-8 rounded-xl border border-[var(--border)] bg-[var(--panel-bg)] text-[var(--app-fg)] hover:bg-[var(--panel-2)] transition flex items-center justify-center shadow-[var(--shadow-2)]"
                  aria-label="common.m80f8fbcfa011"
                >
                  <ZoomIn className="h-4 w-4" />
                </button></UiProps>
                <UiProps ids={{"aria-label":["common.m2f9daa828907"]}}><button
                  type="button"
                  onClick={onDelete}
                  className="h-8 w-8 rounded-xl border border-[var(--border)] bg-[var(--panel-bg)] text-[var(--app-fg)] hover:bg-[var(--panel-2)] transition flex items-center justify-center shadow-[var(--shadow-2)]"
                  aria-label="common.m2f9daa828907"
                >
                  <Trash2 className="h-4 w-4" />
                </button></UiProps>
              </div>
            ) : null}

            <input ref={inputRef} type="file" className="hidden" accept={accept} onChange={(e) => setFromFileList(e.target.files)} />
          </div>
        </div>
      ) : (
        <div
          className={[base, "group", className || ""].join(" ")}
          onDragEnter={(e) => {
            if (!isSupportedDrag(e)) return;
            e.preventDefault();
            setDragging(true);
          }}
          onDragOver={(e) => {
            if (!isSupportedDrag(e)) return;
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={(e) => {
            if (!isSupportedDrag(e)) return;
            e.preventDefault();
            setDragging(false);
          }}
          onDrop={onDrop}
        >
          <div
            className={[
              "relative group/preview rounded-xl border border-[var(--border)] bg-[var(--panel-bg)] overflow-hidden flex items-center justify-center h-20 w-20 flex-shrink-0 shadow-[var(--shadow-2)]"
            ].join(" ")}
            onClick={pick}
            role="button"
            tabIndex={0}
          >
            {previewUrl ? (
              kind === "video" ? (
                <video src={previewUrl} className="h-full w-full object-contain" muted playsInline />
              ) : (
                <img src={previewUrl} alt={title} className="h-full w-full object-contain" />
              )
            ) : (
              <div className="text-[11px] text-[var(--app-muted)]"><UiText id="common.m61058d5170cd" /></div>
            )}

            {previewUrl ? (
              <div className="absolute bottom-2 right-2 flex items-center gap-2 opacity-0 pointer-events-none group-hover/preview:opacity-100 group-hover/preview:pointer-events-auto transition">
                <UiProps ids={{"aria-label":["common.m80f8fbcfa011"]}}><button
                  type="button"
                  onClick={onZoom}
                  className="h-9 w-9 rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] text-[var(--app-muted)] hover:bg-[var(--panel-2)] hover:text-[var(--app-fg)] transition flex items-center justify-center shadow-[var(--shadow-2)]"
                  aria-label="common.m80f8fbcfa011"
                >
                  <ZoomIn className="h-4 w-4" />
                </button></UiProps>
                <UiProps ids={{"aria-label":["common.m2f9daa828907"]}}><button
                  type="button"
                  onClick={onDelete}
                  className="h-9 w-9 rounded-2xl border border-rose-500/20 bg-rose-500/10 text-rose-700 hover:bg-rose-500/15 transition flex items-center justify-center shadow-[var(--shadow-2)]"
                  aria-label="common.m2f9daa828907"
                >
                  <Trash2 className="h-4 w-4" />
                </button></UiProps>
              </div>
            ) : null}
          </div>
          <div className="min-w-0 flex-1 space-y-2">
            <button
              type="button"
              onClick={pick}
              className="w-full h-11 px-4 rounded-2xl border border-[var(--border)] bg-[var(--panel-2)] text-sm text-[var(--app-fg)] hover:bg-[var(--panel-3)] transition flex items-center justify-center gap-2"
            >
              <Upload className="h-4 w-4" />
              {file ? <UiText id="common.meaa8249ad985" /> : <UiText id="common.mcfa7537eba8b" />}
            </button>
          </div>
          <input ref={inputRef} type="file" className="hidden" accept={accept} onChange={(e) => setFromFileList(e.target.files)} />
        </div>
      )}

      <MediaLightbox open={lightboxOpen} src={previewUrl} kind={kind} title={title} onClose={() => setLightboxOpen(false)} />
    </>
  );
}
