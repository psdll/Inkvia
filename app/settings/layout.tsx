import type { ReactNode } from "react";
import { DesktopModeProvider } from "@/components/system/desktop-mode";
import { isDesktopMode } from "@/lib/desktop-mode";

export default function SettingsLayout({ children }: { children: ReactNode }) {
  return <DesktopModeProvider value={isDesktopMode()}>{children}</DesktopModeProvider>;
}
