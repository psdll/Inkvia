import sharp from "sharp";

export function animatedGifFixture() {
  const pixels = Buffer.concat([Buffer.alloc(16 * 16 * 3, 0), Buffer.alloc(16 * 16 * 3, 255)]);
  return sharp(pixels, { raw: { width: 16, height: 32, channels: 3, pageHeight: 16 } })
    .gif({ loop: 0, delay: [200, 200] }).toBuffer();
}
