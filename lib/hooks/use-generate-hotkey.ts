"use client";

import * as React from "react";

const STORAGE_HOTKEY = "settings_hotkey_generate_v1";
const DEFAULT_HOTKEY = "Ctrl+Enter";

export function useGenerateHotkey() {
  const [hotkey, setHotkey] = React.useState(DEFAULT_HOTKEY);

  React.useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_HOTKEY);
      if (saved) setHotkey(saved);
    } catch {}
  }, []);

  React.useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_HOTKEY) return;
      const next = String(e.newValue || "").trim() || DEFAULT_HOTKEY;
      setHotkey(next);
    };

    const onHotkey = (e: Event) => {
      const ce = e as CustomEvent<{ hotkey?: string }>;
      const next = String(ce.detail?.hotkey || "").trim() || DEFAULT_HOTKEY;
      setHotkey(next);
    };

    window.addEventListener("storage", onStorage);
    window.addEventListener("settings:hotkey", onHotkey as EventListener);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("settings:hotkey", onHotkey as EventListener);
    };
  }, []);

  return hotkey;
}

