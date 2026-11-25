"use client";
import { UiText } from "@/i18n/ui";


import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Lightbulb, Upload } from "lucide-react";
import { useAuth } from "@/components/auth/AuthProvider";
import { settingsEntryOptions } from "@/lib/client/settings-queries";

export function MaterialTools() {
  const { user } = useAuth();
  const { data } = useQuery(settingsEntryOptions(user?.id));
  const style = "inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 text-xs text-[var(--app-muted)] hover:bg-[var(--panel-2)] hover:text-[var(--app-fg)]";
  return <>{data?.hasMaterialInspirations && <Link href="/material-inspirations" className={style}><Lightbulb size={13} /><UiText id="settings.m1a72a426a282" /></Link>}{data?.canUploadMaterial && <Link href="/materials/upload" className={style}><Upload size={13} /><UiText id="settings.m493ee58f81f5" /></Link>}</>;
}
