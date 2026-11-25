export type CropRect = { x: number; y: number; w: number; h: number };
export type CropResizeHandle = "n" | "e" | "s" | "w" | "nw" | "ne" | "se" | "sw";
export type CropInteraction = "move" | CropResizeHandle;

export const MIN_CROP_SIZE = 0.03;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function normalized(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

export function updateCropRect(
  start: CropRect,
  interaction: CropInteraction,
  deltaX: number,
  deltaY: number,
  minSize = MIN_CROP_SIZE,
): CropRect {
  if (interaction === "move") {
    return {
      ...start,
      x: normalized(clamp(start.x + deltaX, 0, 1 - start.w)),
      y: normalized(clamp(start.y + deltaY, 0, 1 - start.h)),
    };
  }

  let left = start.x;
  let top = start.y;
  let right = start.x + start.w;
  let bottom = start.y + start.h;

  if (interaction.includes("w")) {
    const effectiveMin = Math.min(minSize, right);
    left = clamp(left + deltaX, 0, right - effectiveMin);
  }
  if (interaction.includes("e")) {
    const effectiveMin = Math.min(minSize, 1 - left);
    right = clamp(right + deltaX, left + effectiveMin, 1);
  }
  if (interaction.includes("n")) {
    const effectiveMin = Math.min(minSize, bottom);
    top = clamp(top + deltaY, 0, bottom - effectiveMin);
  }
  if (interaction.includes("s")) {
    const effectiveMin = Math.min(minSize, 1 - top);
    bottom = clamp(bottom + deltaY, top + effectiveMin, 1);
  }

  return {
    x: normalized(left),
    y: normalized(top),
    w: normalized(interaction.includes("e") || interaction.includes("w") ? right - left : start.w),
    h: normalized(interaction.includes("n") || interaction.includes("s") ? bottom - top : start.h),
  };
}
