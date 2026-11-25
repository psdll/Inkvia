// admin 页面的共享工具函数。
// 各 admin 子面板（FeedbackCenterPanel 等）抽离后共用，避免在多个组件里重复定义。

import { isVideoMediaUrl, normalizeMediaUrl } from "@/lib/media-url";

export function fmtTime(value: string | number | Date | null | undefined) {
  if (value === null || value === undefined || value === "") return "--";
  const t = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(t.getTime())) return "--";
  const yyyy = t.getFullYear();
  const month = t.getMonth() + 1;
  const day = t.getDate();
  const hh = String(t.getHours()).padStart(2, "0");
  const mm = String(t.getMinutes()).padStart(2, "0");
  const ss = String(t.getSeconds()).padStart(2, "0");
  return `${yyyy}年${month}月${day}日 ${hh}:${mm}:${ss}`;
}

export function adminDisplayName(user: { username?: string | null; userId?: string | null }) {
  const username = String(user.username || "").trim();
  if (username) return username;
  return "";
}

export function isVideoPath(p: string | null | undefined) {
  return isVideoMediaUrl(p);
}

export function isImagePath(p: string | null | undefined) {
  const s = normalizeMediaUrl(p).toLowerCase();
  const base = s.split("?")[0]?.split("#")[0] || "";
  return base.endsWith(".png") || base.endsWith(".jpg") || base.endsWith(".jpeg") || base.endsWith(".webp") || base.endsWith(".gif");
}
