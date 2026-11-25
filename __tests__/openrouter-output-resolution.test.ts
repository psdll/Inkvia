import { animatedGifFixture } from "./helpers/animated-gif";
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { validateOpenRouterImageOutputs } from "@/lib/openrouter-image";

const input = { model: "gemini-3-pro-image-openrouter", prompt: "chair", aspectRatio: "3:4", resolution: "2K" };
async function image(width: number, height: number) {
  const bytes = await sharp({ create: { width, height, channels: 3, background: "#999" } }).png().toBuffer();
  return `data:image/png;base64,${bytes.toString("base64")}`;
}
describe("Nano Banana Pro actual output resolution", () => {
  it("rejects the observed 1K response to a 2K request", async () => {
    await expect(validateOpenRouterImageOutputs(input, [await image(896, 1200)])).rejects.toThrow(/请求 2K.*896×1200/);
  });
  it("accepts the verified 2K original and reports its actual pixels", async () => {
    await expect(validateOpenRouterImageOutputs(input, [await image(1792, 2400)])).resolves.toEqual([{ width: 1792, height: 2400 }]);
  });
  it("checks fixed aspect ratio as well as pixel count", async () => {
    await expect(validateOpenRouterImageOutputs(input, [await image(2048, 2048)])).rejects.toThrow(/比例不符/);
  });
  it("allows native ratio rounding and adaptive proportions", async () => {
    await expect(validateOpenRouterImageOutputs({ ...input, aspectRatio: "2:3" }, [await image(1696, 2528)])).resolves.toEqual([{ width: 1696, height: 2528 }]);
    await expect(validateOpenRouterImageOutputs({ ...input, aspectRatio: "21:9" }, [await image(3168, 1344)])).resolves.toEqual([{ width: 3168, height: 1344 }]);
    await expect(validateOpenRouterImageOutputs({ ...input, aspectRatio: "auto" }, [await image(2048, 2048)])).resolves.toEqual([{ width: 2048, height: 2048 }]);
  });
  it("uses the requested 1K and 4K pixel budgets", async () => {
    await expect(validateOpenRouterImageOutputs({ ...input, resolution: "1K" }, [await image(896, 1200)])).resolves.toEqual([{ width: 896, height: 1200 }]);
    await expect(validateOpenRouterImageOutputs({ ...input, resolution: "4K" }, [await image(1792, 2400)])).rejects.toThrow(/请求 4K/);
  });
  it("keeps other OpenRouter model families on their own output contracts", async () => {
    await expect(validateOpenRouterImageOutputs({ ...input, model: "gpt-image-2-openrouter" }, ["data:image/png;base64,YQ=="])).resolves.toBeUndefined();
  });
});


it("checks that GIF output contains multiple frames instead of accepting a static picture", async () => {
  const gifInput = { model: "gpt-image-2.6-flare-openrouter", prompt: "waves", outputFormat: "gif" };
  await expect(validateOpenRouterImageOutputs(gifInput, [await image(16, 16)])).rejects.toThrow(/动图/);
  const gif = await animatedGifFixture();
  await expect(validateOpenRouterImageOutputs(gifInput, [`data:image/gif;base64,${gif.toString("base64")}`])).resolves.toEqual([{ width: 16, height: 16, frameCount: 2 }]);
});
