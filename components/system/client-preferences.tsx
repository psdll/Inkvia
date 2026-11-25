"use client";

import * as React from "react";
import { usePathname } from "next/navigation";

const STORAGE_THEME = "app-theme";
const LEGACY_STORAGE_THEME = "settings_theme_v1";

function resolveTheme(theme: string | null) {
  if (theme === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return theme === "dark" ? "dark" : "light";
}

function applyTheme(theme: string | null) {
  const mode = resolveTheme(theme);
  const root = document.documentElement;
  root.setAttribute("data-theme", mode);
  root.classList.toggle("dark", mode !== "light");
}

export function ClientPreferences() {
  const pathname = usePathname();

  React.useEffect(() => {
    try {
      const theme = localStorage.getItem(STORAGE_THEME) || localStorage.getItem(LEGACY_STORAGE_THEME) || "dark";
      applyTheme(theme);
    } catch {}

    const onStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_THEME || event.key === LEGACY_STORAGE_THEME) {
        applyTheme(event.newValue);
      }
    };

    const onTheme = (event: Event) => {
      const customEvent = event as CustomEvent<{ theme?: string; effective?: string }>;
      applyTheme(customEvent.detail?.effective || customEvent.detail?.theme || null);
    };

    window.addEventListener("storage", onStorage);
    window.addEventListener("settings:theme", onTheme as EventListener);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("settings:theme", onTheme as EventListener);
    };
  }, [pathname]);

  return null;
}
