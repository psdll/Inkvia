import sharp from "sharp";
import { describe, expect, it } from "vitest";

import {
  PROMPT_REVERSE_RELAY_MAX_EDGE,
  preparePromptReverseRelayImage,
} from "@/lib/prompt-reverse-media";

describe("prompt reverse media relay", () => {
  it("turns an oversized PNG into a bounded JPEG relay image", async () => {
    const input = await sharp({
      create: {
        width: 4284,
        height: 5712,
        channels: 4,
        background: { r: 231, g: 223, b: 206, alpha: 0.6 },
      },
    }).png().toBuffer();

    const output = await preparePromptReverseRelayImage(input);
    const metadata = await sharp(output).metadata();

    expect(metadata.format).toBe("jpeg");
    expect(metadata.hasAlpha).toBe(false);
    expect(metadata.width).toBeLessThanOrEqual(PROMPT_REVERSE_RELAY_MAX_EDGE);
    expect(metadata.height).toBeLessThanOrEqual(PROMPT_REVERSE_RELAY_MAX_EDGE);
    expect(Math.max(metadata.width || 0, metadata.height || 0)).toBe(
      PROMPT_REVERSE_RELAY_MAX_EDGE,
    );
  });

  it("does not enlarge a small reference image", async () => {
    const input = await sharp({
      create: {
        width: 640,
        height: 480,
        channels: 3,
        background: { r: 80, g: 100, b: 120 },
      },
    }).png().toBuffer();

    const output = await preparePromptReverseRelayImage(input);
    const metadata = await sharp(output).metadata();

    expect(metadata.width).toBe(640);
    expect(metadata.height).toBe(480);
  });
});
