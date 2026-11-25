"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";

const STORAGE_KEY = "inkvia.desktop.lastWorkspacePath";

function isWorkspacePath(pathname: string) {
  return pathname !== "/canvas" && !pathname.startsWith("/canvas/")
    && pathname !== "/admin" && !pathname.startsWith("/admin/");
}

export function DesktopWorkspacePathTracker() {
  const pathname = usePathname();
  const search = useSearchParams()?.toString();

  useEffect(() => {
    if (!pathname || !isWorkspacePath(pathname)) return;
    try {
      const { pathname: currentPath, search: currentSearch } = window.location;
      if (currentPath === pathname) sessionStorage.setItem(STORAGE_KEY, currentPath + currentSearch);
    } catch {}
  }, [pathname, search]);

  return null;
}

export function readLastDesktopWorkspacePath() {
  try {
    const value = sessionStorage.getItem(STORAGE_KEY);
    if (!value?.startsWith("/")) return "/";
    const url = new URL(value, window.location.origin);
    if (url.origin === window.location.origin && isWorkspacePath(url.pathname)) {
      return url.pathname + url.search;
    }
  } catch {}
  return "/";
}
