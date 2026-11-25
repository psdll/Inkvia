// https://api-docs.deepseek.com/zh-cn/quick_start/pricing/ (2026-09-22).
const flash = { input_million_token: "2", output_million_token: "8", cached_million_token: "0.04" };
const pro = { input_million_token: "9", output_million_token: "27", cached_million_token: "0.30" };
export const DEEPSEEK_QUOTES = Object.fromEntries(
  ["deepseek-flash", "deepseek-v4-flash", "deepseek-v4-flash-vision-exp", "deepseek-v4-pro"].map((model) => [model,
    ["peak", "off_peak"].flatMap((deepseekTimeBand) => Object.entries(model === "deepseek-v4-pro" ? pro : flash).map(([unitType, price]) => ({
      conditions: { deepseekTimeBand }, unitType,
      price: String(Number(price) / (deepseekTimeBand === "peak" ? 1 : 2)),
    }))),
  ]),
);
// Published national holiday schedule; weekends remain off-peak even on makeup workdays.
// https://www.beijing.gov.cn/fuwu/bmfw/sy/jrts/202511/t20251104_4258838.html
const holidays2026 = [["01-01", "01-03"], ["02-15", "02-23"], ["04-04", "04-06"], ["05-01", "05-05"], ["06-19", "06-21"], ["09-25", "09-27"], ["10-01", "10-07"]];
export function deepseekTimeBand(at: Date | string): "peak" | "off_peak" | undefined {
  const local = new Date(+new Date(at) + 8 * 3600000);
  if (!Number.isFinite(+local)) return undefined;
  const day = local.getUTCDay(), hour = local.getUTCHours();
  if (day === 0 || day === 6 || !((hour >= 9 && hour < 12) || (hour >= 14 && hour < 18))) return "off_peak";
  // Never guess a weekday holiday status for a year whose calendar has not been verified.
  if (local.getUTCFullYear() !== 2026) return undefined;
  const date = local.toISOString().slice(5, 10);
  return holidays2026.some(([from, to]) => date >= from && date <= to) ? "off_peak" : "peak";
}
