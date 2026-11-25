export type VideoCrop = { left: number; top: number; width: number; height: number; sourceWidth: number; sourceHeight: number };
export type VideoCropHandle = 'move' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
const even = (value: number) => Math.round(value / 2) * 2;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
export function initialVideoCrop(sourceWidth: number, sourceHeight: number): VideoCrop {
  const width = Math.max(2, even(sourceWidth * .8)), height = Math.max(2, even(sourceHeight * .8));
  return { left: Math.floor((sourceWidth - width) / 2), top: Math.floor((sourceHeight - height) / 2), width, height, sourceWidth, sourceHeight };
}
export function adjustVideoCrop(crop: VideoCrop, handle: VideoCropHandle, dx: number, dy: number): VideoCrop {
  if (handle === 'move') return { ...crop, left: clamp(Math.round(crop.left + dx), 0, crop.sourceWidth - crop.width), top: clamp(Math.round(crop.top + dy), 0, crop.sourceHeight - crop.height) };
  let { left, top, width, height } = crop;
  if (handle.includes('w')) { width = clamp(even(crop.width - dx), 2, 2 * Math.floor((crop.left + crop.width) / 2)); left = crop.left + crop.width - width; }
  if (handle.includes('e')) width = clamp(even(crop.width + dx), 2, 2 * Math.floor((crop.sourceWidth - left) / 2));
  if (handle.includes('n')) { height = clamp(even(crop.height - dy), 2, 2 * Math.floor((crop.top + crop.height) / 2)); top = crop.top + crop.height - height; }
  if (handle.includes('s')) height = clamp(even(crop.height + dy), 2, 2 * Math.floor((crop.sourceHeight - top) / 2));
  return { ...crop, left, top, width, height };
}
