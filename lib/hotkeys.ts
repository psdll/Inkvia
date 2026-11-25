"use client";

export type HotkeySpec = {
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
  key: string;
};

function normalizeKeyName(raw: string) {
  if (!raw) return "";
  if (raw === " ") return "Space";
  if (raw.length === 1) return raw.toUpperCase();
  if (raw === "Escape") return "Esc";
  return raw;
}

export function isEditableTarget(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = (el.tagName || "").toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  if ((el as any).isContentEditable) return true;
  return false;
}

export function parseHotkeyString(raw: string | null | undefined): HotkeySpec | null {
  const s = String(raw || "").trim();
  if (!s) return null;
  const parts = s.split("+").map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return null;
  const modSet = new Set(parts.map((p) => p.toLowerCase()));
  const keyPart = parts
    .slice()
    .reverse()
    .find((p) => {
      const v = p.toLowerCase();
      return v !== "ctrl" && v !== "control" && v !== "alt" && v !== "shift" && v !== "meta" && v !== "cmd" && v !== "command";
    });
  if (!keyPart) return null;
  return {
    ctrl: modSet.has("ctrl") || modSet.has("control"),
    alt: modSet.has("alt"),
    shift: modSet.has("shift"),
    meta: modSet.has("meta") || modSet.has("cmd") || modSet.has("command"),
    key: normalizeKeyName(keyPart)
  };
}

export function matchHotkey(e: KeyboardEvent, spec: HotkeySpec | null) {
  if (!spec) return false;
  if (e.ctrlKey !== spec.ctrl) return false;
  if (e.altKey !== spec.alt) return false;
  if (e.shiftKey !== spec.shift) return false;
  if (e.metaKey !== spec.meta) return false;
  const k = normalizeKeyName(e.key || "");
  return k === spec.key;
}

