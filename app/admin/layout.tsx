import * as React from "react";
import { cookies } from "next/headers";
import { adminCookieName, verifyAdminToken } from "@/lib/admin-auth";
import { AdminSessionGate } from "@/components/admin/AdminSessionGate";
import { AdminDropdownThemeScope } from "@/components/admin/AdminDropdownThemeScope";
import { DesktopModeProvider } from "@/components/system/desktop-mode";
import { isDesktopMode } from "@/lib/desktop-mode";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <DesktopModeProvider value={isDesktopMode()}>
      <AdminSessionGate initialAuthenticated={Boolean(verifyAdminToken(cookies().get(adminCookieName())?.value))}>
        <AdminDropdownThemeScope />
        {children}
      </AdminSessionGate>
    </DesktopModeProvider>
  );
}
