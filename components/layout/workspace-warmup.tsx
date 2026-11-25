"use client";

import { useQueryClient } from "@tanstack/react-query";

import { useAuth } from "@/components/auth/AuthProvider";
import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { FAST_WORKSPACE_ROUTES, warmWorkspaceRoute } from "@/lib/client/warm-workspace-route";
import { loadImageModelCatalog } from "@/lib/client/image-model-catalog";
import { subscribeToolboxModelVisibilityChanged } from "@/lib/toolbox-model-visibility-events";

export function WorkspaceWarmup() {
  const pathname = usePathname();
  const { user } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  useEffect(() => subscribeToolboxModelVisibilityChanged(() => {
    void loadImageModelCatalog({ refresh: true }).catch(() => undefined);
  }), []);
  useEffect(() => {
    // Opening settings must not start warming all of the heavier workspaces.
    if (pathname === "/settings") return;
    const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
    if (connection?.saveData || /(^|-)2g$/.test(connection?.effectiveType || "")) return;
    if (!FAST_WORKSPACE_ROUTES.some(route => route === pathname)) return;
    const destinations = FAST_WORKSPACE_ROUTES.filter(route => route !== pathname);
    let cancelled = false;
    let idle: number | undefined;
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      timer = setTimeout(() => {
        if (cancelled) return;
        if (document.visibilityState === "hidden") { schedule(); return; }
        if (typeof window.requestIdleCallback === "function") idle = window.requestIdleCallback(run);
        else void run();
      }, 1000);
    };
    const run = async () => {
      if (cancelled) return;
      const destination = destinations.shift();
      if (!destination) return;
      router.prefetch(destination);
      await warmWorkspaceRoute(destination, user ? String(user.id) : undefined, queryClient);
      if (!cancelled && destinations.length) schedule();
    };
    schedule();
    return () => {
      cancelled = true;
      clearTimeout(timer);
      if (idle !== undefined) window.cancelIdleCallback(idle);
    };
  }, [pathname, router, user?.id, queryClient]);
  return null;
}
