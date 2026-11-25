"use client";
import { createContext, useContext } from "react";

export const CanvasReadOnlyContext = createContext(false);
export const useCanvasReadOnly = () => useContext(CanvasReadOnlyContext);

// Present only for the administrator's isolated, read-only data source.
export const CanvasObserverContext = createContext<string | undefined>(undefined);
export const useCanvasObserver = () => useContext(CanvasObserverContext);

export function canvasObserverUrl(url: string, adminKey?: string) {
  if (!adminKey) return url;
  return `/api/admin/user/canvas-resources?${new URLSearchParams({ adminKey, resource: url })}`;
}
