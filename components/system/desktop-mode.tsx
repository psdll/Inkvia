"use client";

import { createContext, useContext, type ReactNode } from "react";

const DesktopModeContext = createContext(false);

export function DesktopModeProvider({ value, children }: { value: boolean; children: ReactNode }) {
  return <DesktopModeContext.Provider value={value}>{children}</DesktopModeContext.Provider>;
}

export function useDesktopMode() {
  return useContext(DesktopModeContext);
}

export function isHiddenDesktopAdminTab(tab: string | null | undefined) {
  return tab === "monitoring" || tab === "feedback_center";
}
