"use client";

import * as React from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { publishGenerationDeleted } from "@/lib/generation-deletion-events";

const POLL_MS = 3000;
const PAGE_SIZE = 500;

export function GenerationDeletionSync() {
  const { user } = useAuth();
  const accountId = user?.id ? String(user.id) : "";

  React.useEffect(() => {
    if (!accountId) return;
    let disposed = false;
    let inFlight = false;
    let timer: number | null = null;
    const storageKey = `generation_deletion_cursor_v1_${accountId}`;
    const idsStorageKey = `generation_deleted_ids_v1_${accountId}`;
    const persistedIds = new Set<number>();
    let cursor = 0;
    try {
      cursor = Math.max(0, Number(localStorage.getItem(storageKey) || 0) || 0);
      const rawIds = JSON.parse(localStorage.getItem(idsStorageKey) || "[]");
      if (Array.isArray(rawIds)) {
        for (const value of rawIds) {
          const id = Number(value);
          if (Number.isSafeInteger(id) && id > 0) persistedIds.add(id);
        }
      }
    } catch {}
    publishGenerationDeleted(persistedIds, false);

    const schedule = () => {
      if (disposed) return;
      if (timer != null) window.clearTimeout(timer);
      timer = window.setTimeout(() => void run(), POLL_MS);
    };
    const run = async () => {
      if (disposed || inFlight || document.visibilityState === "hidden") return schedule();
      inFlight = true;
      try {
        for (let page = 0; page < 10 && !disposed; page += 1) {
          const response = await fetch(`/api/generation-deletions?after=${cursor}&take=${PAGE_SIZE}`, { cache: "no-store" });
          if (!response.ok) break;
          const payload = await response.json().catch(() => null) as any;
          const ids = Array.isArray(payload?.ids) ? payload.ids : [];
          publishGenerationDeleted(ids);
          for (const value of ids) {
            const id = Number(value);
            if (Number.isSafeInteger(id) && id > 0) persistedIds.add(id);
          }
          try {
            localStorage.setItem(idsStorageKey, JSON.stringify(Array.from(persistedIds).slice(-5000)));
          } catch {}
          const nextCursor = Math.max(cursor, Number(payload?.cursor || 0) || 0);
          if (nextCursor !== cursor) {
            cursor = nextCursor;
            try { localStorage.setItem(storageKey, String(cursor)); } catch {}
          }
          if (!payload?.hasMore) break;
        }
      } catch {
        // Keep the last cursor and retry. Deletion synchronization is a fallback;
        // it must never make the application unavailable.
      } finally {
        inFlight = false;
        schedule();
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") void run();
    };
    document.addEventListener("visibilitychange", onVisibility);
    void run();
    return () => {
      disposed = true;
      if (timer != null) window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [accountId]);

  return null;
}
