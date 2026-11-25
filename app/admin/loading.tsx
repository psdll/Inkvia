"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { AdminLoading } from "@/components/admin/admin-loading";
import { isHiddenDesktopAdminTab, useDesktopMode } from "@/components/system/desktop-mode";

function RouteLoading() {
  const params = useSearchParams();
  const desktopMode = useDesktopMode();
  const tab = params.get("tab");
  return <AdminLoading tab={desktopMode && isHiddenDesktopAdminTab(tab) ? "overview" : tab} />;
}

export default function Loading() {
  return <Suspense fallback={<AdminLoading />}><RouteLoading /></Suspense>;
}
