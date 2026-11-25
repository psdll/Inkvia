import sharp from "sharp";

export const PROMPT_REVERSE_RELAY_MAX_EDGE = 2048;

export async function preparePromptReverseRelayImage(input: Buffer) {
  return sharp(input, {
    animated: false,
    autoOrient: true,
    failOn: "none",
    limitInputPixels: 80_000_000,
  })
    .flatten({ background: "#ffffff" })
    .resize({
      width: PROMPT_REVERSE_RELAY_MAX_EDGE,
      height: PROMPT_REVERSE_RELAY_MAX_EDGE,
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: 88, mozjpeg: true })
    .toBuffer();
}
