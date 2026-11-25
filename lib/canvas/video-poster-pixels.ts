/** Detect a blank fade-in frame without mistaking a dark scene for missing pixels. */
export function isCanvasVideoPosterBlack(source: CanvasImageSource) {
  try {
    const sample = document.createElement("canvas");
    sample.width = sample.height = 16;
    const context = sample.getContext("2d");
    if (!context || typeof context.getImageData !== "function") return false;
    context.drawImage(source, 0, 0, 16, 16);
    const pixels = context.getImageData(0, 0, 16, 16).data;
    let sum = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      const red = pixels[index], green = pixels[index + 1], blue = pixels[index + 2];
      if (Math.max(red, green, blue) > 8) return false;
      sum += red + green + blue;
    }
    return sum / (16 * 16 * 3) <= 2;
  } catch { return false; }
}
