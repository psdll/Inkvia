const SHANGHAI_TIME_ZONE = "Asia/Shanghai";

const shanghaiDayFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: SHANGHAI_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function adminDayKey(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = shanghaiDayFormatter.formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return year && month && day ? `${year}-${month}-${day}` : "";
}

export function adminStartOfDay(offsetDays = 0, now = new Date()): Date {
  const target = new Date(now.getTime() - Math.max(0, offsetDays) * 24 * 60 * 60 * 1000);
  return new Date(`${adminDayKey(target)}T00:00:00+08:00`);
}

export function adminWeekday(value = new Date()): number {
  const day = adminDayKey(value);
  return day ? new Date(`${day}T00:00:00Z`).getUTCDay() : value.getUTCDay();
}
