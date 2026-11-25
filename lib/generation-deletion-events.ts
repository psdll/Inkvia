"use client";

import { normalizeDeletedGenerationIds } from "@/lib/generation-deletion";

export const GENERATION_DELETED_EVENT = "generation:deleted";
const CHANNEL_NAME = "inkvia-generation-deletions";
const knownDeletedIds = new Set<number>();
let channel: BroadcastChannel | null = null;

function dispatch(ids: number[]) {
  if (!ids.length || typeof window === "undefined") return;
  for (const id of ids) knownDeletedIds.add(id);
  window.dispatchEvent(new CustomEvent(GENERATION_DELETED_EVENT, { detail: { ids } }));
}

function getChannel() {
  if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") return null;
  if (!channel) {
    channel = new BroadcastChannel(CHANNEL_NAME);
    channel.addEventListener("message", (event) => {
      dispatch(Array.from(normalizeDeletedGenerationIds(event.data?.ids || [])));
    });
  }
  return channel;
}

export function publishGenerationDeleted(values: Iterable<unknown>, broadcast = true) {
  const ids = Array.from(normalizeDeletedGenerationIds(values));
  dispatch(ids);
  if (broadcast && ids.length) getChannel()?.postMessage({ ids });
  return ids;
}

export function subscribeGenerationDeleted(listener: (ids: number[]) => void) {
  if (typeof window === "undefined") return () => undefined;
  getChannel();
  const handler = (event: Event) => {
    const ids = Array.from(normalizeDeletedGenerationIds((event as CustomEvent<{ ids?: unknown[] }>).detail?.ids || []));
    if (ids.length) listener(ids);
  };
  window.addEventListener(GENERATION_DELETED_EVENT, handler);
  return () => window.removeEventListener(GENERATION_DELETED_EVENT, handler);
}

export function getKnownDeletedGenerationIds() {
  return new Set(knownDeletedIds);
}

export function isKnownDeletedGenerationId(value: unknown) {
  return knownDeletedIds.has(Number(value));
}
