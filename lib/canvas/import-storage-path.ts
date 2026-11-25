const shanghaiDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function merchantFolderName(username: string, userId: number | null) {
  const safe = String(username || "")
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/\.+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[_ .]+|[_ .]+$/g, "")
    .slice(0, 64);
  return safe || `商家${userId || "未知"}`;
}

function shanghaiDay(value: Date) {
  const parts = shanghaiDateFormatter.formatToParts(value);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  if (!year || !month || !day) throw new Error("invalid canvas import date");
  return `${year}${month}${day}`;
}

export function buildCanvasImportStorageFolder(
  username: string,
  userId: number | null,
  createdAt: Date,
) {
  return `canvas_imports/${merchantFolderName(username, userId)}_${shanghaiDay(createdAt)}`;
}
