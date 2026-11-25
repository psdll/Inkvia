"use client";

export const MEDIA_LIBRARY_EVENT_TOGGLE = "media-library:toggle";
export const MEDIA_LIBRARY_EVENT_OPEN = "media-library:open";
export const MEDIA_LIBRARY_EVENT_CLOSE = "media-library:close";
export const MEDIA_LIBRARY_PENDING_OPEN_KEY = "studio_media_library_open_v1";

function emit(name: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(name));
}

export function toggleMediaLibraryPanel() {
  emit(MEDIA_LIBRARY_EVENT_TOGGLE);
}

export function openMediaLibraryPanel() {
  emit(MEDIA_LIBRARY_EVENT_OPEN);
}

export function closeMediaLibraryPanel() {
  emit(MEDIA_LIBRARY_EVENT_CLOSE);
}

export function rememberOpenMediaLibraryPanel() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(MEDIA_LIBRARY_PENDING_OPEN_KEY, "1");
  } catch {}
}

export function consumePendingMediaLibraryOpen() {
  if (typeof window === "undefined") return false;
  try {
    const shouldOpen = window.localStorage.getItem(MEDIA_LIBRARY_PENDING_OPEN_KEY) === "1";
    if (shouldOpen) {
      window.localStorage.removeItem(MEDIA_LIBRARY_PENDING_OPEN_KEY);
    }
    return shouldOpen;
  } catch {
    return false;
  }
}

export function isMediaLibraryCapablePath(pathname: string | null | undefined) {
  const path = String(pathname || "").trim();
  return path === "/studio"
    || path === "/image"
    || path === "/video"
    || path === "/batch-workbench";
}
