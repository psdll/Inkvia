"use client";

export const TOOLBOX_MODEL_VISIBILITY_EVENT = "toolbox-model-visibility:changed";
export const TOOLBOX_MODEL_VISIBILITY_CHANNEL = "inkvia-toolbox-model-visibility";
export const TOOLBOX_MODEL_VISIBILITY_STORAGE_KEY = "inkvia-toolbox-model-visibility:revision";

let channel: BroadcastChannel | null = null;

function dispatchChange() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(TOOLBOX_MODEL_VISIBILITY_EVENT));
}

function getChannel() {
  if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") return null;
  if (!channel) {
    try { channel = new BroadcastChannel(TOOLBOX_MODEL_VISIBILITY_CHANNEL); }
    catch { return null; }
    channel.addEventListener("message", (event) => {
      if (event.data?.type === "changed") dispatchChange();
    });
  }
  return channel;
}

export function publishToolboxModelVisibilityChanged() {
  dispatchChange();
  try { getChannel()?.postMessage({ type: "changed" }); } catch {}
  try {
    window.localStorage.setItem(TOOLBOX_MODEL_VISIBILITY_STORAGE_KEY, `${Date.now()}:${Math.random()}`);
  } catch {}
}

export function subscribeToolboxModelVisibilityChanged(listener: () => void) {
  if (typeof window === "undefined") return () => undefined;
  getChannel();
  const refreshWhenVisible = () => {
    if (typeof document === "undefined" || document.visibilityState === "visible") listener();
  };
  const onStorage = (event: StorageEvent) => {
    if (!channel && event.key === TOOLBOX_MODEL_VISIBILITY_STORAGE_KEY && event.newValue) listener();
  };
  window.addEventListener(TOOLBOX_MODEL_VISIBILITY_EVENT, listener);
  // Background tabs can miss a broadcast. Revalidate on return without reloading
  // the page or discarding prompts, uploads, or canvas edits.
  window.addEventListener("focus", refreshWhenVisible);
  window.addEventListener("pageshow", refreshWhenVisible);
  window.addEventListener("storage", onStorage);
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", refreshWhenVisible);
  return () => {
    window.removeEventListener(TOOLBOX_MODEL_VISIBILITY_EVENT, listener);
    window.removeEventListener("focus", refreshWhenVisible);
    window.removeEventListener("pageshow", refreshWhenVisible);
    window.removeEventListener("storage", onStorage);
    if (typeof document !== "undefined") document.removeEventListener("visibilitychange", refreshWhenVisible);
  };
}
