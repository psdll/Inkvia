"use client";

import * as React from "react";
import { subscribeToolboxModelVisibilityChanged } from "@/lib/toolbox-model-visibility-events";

let cached: Record<string, string> = {};
let loadedAt = 0;
let pending: Promise<Record<string, string>> | null = null;

function loadNames(force = false) {
  if (pending) return pending;
  if (!force && Date.now() - loadedAt < 30_000) return Promise.resolve(cached);
  pending = fetch("/api/toolbox/model-display-names", { cache: "no-store" }).then(async response => {
    if (!response.ok) throw new Error("Unable to load model names");
    const payload = await response.json();
    if (!payload.displayNames || typeof payload.displayNames !== "object" || Array.isArray(payload.displayNames)) return cached;
    cached = Object.fromEntries(Object.entries(payload.displayNames).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
    loadedAt = Date.now();
    return cached;
  }).catch(() => cached).finally(() => { pending = null; });
  return pending;
}

export function useModelDisplayNames(enabled = true) {
  const [names, setNames] = React.useState(cached);
  React.useEffect(() => {
    if (!enabled) return;
    let active = true;
    const refresh = (force = false) => { void loadNames(force).then(value => { if (active) setNames(value); }); };
    refresh();
    const unsubscribe = subscribeToolboxModelVisibilityChanged(() => refresh(true));
    return () => { active = false; unsubscribe(); };
  }, [enabled]);
  return names;
}
