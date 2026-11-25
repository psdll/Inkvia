"use client";

import Cookies from "js-cookie";
import { v4 as uuidv4 } from "uuid";

const COOKIE_KEY = "ai_studio_device_id";

export function getOrCreateUserId(): string {
  const existing = Cookies.get(COOKIE_KEY);
  if (existing) {
    try {
      localStorage.setItem(COOKIE_KEY, existing);
    } catch {}
    return existing;
  }

  try {
    const fromStorage = localStorage.getItem(COOKIE_KEY);
    if (fromStorage) {
      Cookies.set(COOKIE_KEY, fromStorage, { expires: 365 });
      return fromStorage;
    }
  } catch {}

  const next = uuidv4();
  Cookies.set(COOKIE_KEY, next, { expires: 365 });
  try {
    localStorage.setItem(COOKIE_KEY, next);
  } catch {}
  return next;
}
