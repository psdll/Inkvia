import type { CanvasSelectOption } from "@/lib/canvas/image-task";

/** Prefer the source ratio; automatic sizing preserves nonstandard source dimensions. */
export function resolveAngleAspectRatio(sourceResolution: string | undefined, options: CanvasSelectOption[]): string {
  const available = options.filter(option => !option.disabled && option.value !== "custom");
  const [width, height] = (sourceResolution || "").split(/\s*[×x]\s*/).map(Number);
  const ratio = width > 0 && height > 0 ? width / height : undefined;
  const numeric = available.map(option => {
    const [w, h] = option.value.split(":").map(Number);
    return { value: option.value, ratio: w > 0 && h > 0 ? w / h : 0 };
  }).filter(option => option.ratio > 0);
  const exact = ratio && numeric.find(option => Math.abs(option.ratio / ratio - 1) < 0.005);
  if (exact) return exact.value;
  if (available.some(option => option.value === "auto")) return "auto";
  if (!ratio) return "";
  return numeric.sort((a, b) => Math.abs(Math.log(a.ratio / ratio)) - Math.abs(Math.log(b.ratio / ratio)))[0]?.value || "";
}
