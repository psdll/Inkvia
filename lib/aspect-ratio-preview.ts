export function getAspectRatioPreviewSize(value: string, maxSize: number) {
  const size = Number.isFinite(maxSize) && maxSize > 0 ? maxSize : 20;
  const [rawWidth, rawHeight] = String(value || "").split(":");
  const width = Number(rawWidth);
  const height = Number(rawHeight);

  if (!(width > 0) || !(height > 0)) {
    return { width: size, height: size };
  }
  if (width >= height) {
    return { width: size, height: size * (height / width) };
  }
  return { width: size * (width / height), height: size };
}
