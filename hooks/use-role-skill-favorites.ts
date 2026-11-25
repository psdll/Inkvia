"use client";

import * as React from "react";

const FAVORITES_CHANGED = "role-skills:favorites-changed";
const EMPTY_FAVORITES: string[] = [];
const favoritesByAccount = new Map<string, { storedValue: string | null; ids: string[] }>();

function parseFavorites(value: string | null): string[] {
  try {
    const parsed: unknown = JSON.parse(value || "[]");
    return Array.isArray(parsed)
      ? Array.from(new Set(parsed.filter((id): id is string => typeof id === "string")))
      : [];
  } catch {
    return [];
  }
}

function readFavorites(key: string): string[] {
  if (!key || typeof window === "undefined") return EMPTY_FAVORITES;
  let cached = favoritesByAccount.get(key);
  try {
    const storedValue = window.localStorage.getItem(key);
    if (!cached || cached.storedValue !== storedValue) {
      cached = { storedValue, ids: parseFavorites(storedValue) };
      favoritesByAccount.set(key, cached);
    }
  } catch {}
  return cached?.ids || EMPTY_FAVORITES;
}

export function useRoleSkillFavorites(authUserId: string) {
  // Reuse the canvas key so existing favorites remain available on every page.
  const key = authUserId ? `creative-agent:skill-favorites:v1:${authUserId}` : "";
  const subscribe = React.useCallback((onChange: () => void) => {
    if (!key) return () => {};
    const onFavoritesChanged = (event: Event) => {
      if ((event as CustomEvent<string>).detail === key) onChange();
    };
    const onStorage = (event: StorageEvent) => {
      if (key && (event.key === key || event.key === null)) {
        onChange();
      }
    };
    window.addEventListener(FAVORITES_CHANGED, onFavoritesChanged);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(FAVORITES_CHANGED, onFavoritesChanged);
      window.removeEventListener("storage", onStorage);
    };
  }, [key]);
  const getSnapshot = React.useCallback(() => readFavorites(key), [key]);
  const favoriteSkillIds = React.useSyncExternalStore(subscribe, getSnapshot, () => EMPTY_FAVORITES);

  const updateFavorite = React.useCallback((skillId: string, remove: boolean) => {
    if (!key) return;
    const current = readFavorites(key);
    const next = remove || current.includes(skillId)
      ? current.filter((id) => id !== skillId)
      : [...current, skillId];
    let storedValue = favoritesByAccount.get(key)?.storedValue ?? null;
    try {
      const serialized = JSON.stringify(next);
      window.localStorage.setItem(key, serialized);
      storedValue = serialized;
    } catch { /* Keep favorites usable in this session. */ }
    favoritesByAccount.set(key, { storedValue, ids: next });
    window.dispatchEvent(new CustomEvent(FAVORITES_CHANGED, { detail: key }));
  }, [key]);
  const toggleFavoriteSkill = React.useCallback((skillId: string) => updateFavorite(skillId, false), [updateFavorite]);
  const removeFavoriteSkill = React.useCallback((skillId: string) => updateFavorite(skillId, true), [updateFavorite]);

  return { favoriteSkillIds, toggleFavoriteSkill, removeFavoriteSkill };
}
