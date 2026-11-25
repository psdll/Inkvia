"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { WorkspaceSidebar } from "./workspace-sidebar";
import { PageTransition } from "./page-transition";
import { ProductCacheKeeper } from "@/components/media-library/product-cache-keeper";
import { GenerationDeletionSync } from "@/components/generation/generation-deletion-sync";
import { WorkspaceWarmup } from "./workspace-warmup";
import { useDesktopMode } from "@/components/system/desktop-mode";
import { DesktopWorkspacePathTracker } from "./desktop-workspace-path";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const desktopMode = useDesktopMode();
  const isCanvasRoute = pathname === "/canvas" || pathname?.startsWith("/canvas/");
  const isAdminRoute = pathname === "/admin" || pathname?.startsWith("/admin/");
  const shouldShowSidebar = !isCanvasRoute && (!isAdminRoute || desktopMode);

  return (
    <>
      {desktopMode && <React.Suspense fallback={null}><DesktopWorkspacePathTracker /></React.Suspense>}
      {shouldShowSidebar && <WorkspaceWarmup />}
      <div className="flex min-h-0 min-w-0 flex-1" style={desktopMode ? undefined : { paddingTop: "var(--global-notice-height, 0px)" }}>
        <PageTransition before={shouldShowSidebar && <WorkspaceSidebar />}>
          {children}
        </PageTransition>
      </div>
      <ProductCacheKeeper />
      <GenerationDeletionSync />
    </>
  );
}
