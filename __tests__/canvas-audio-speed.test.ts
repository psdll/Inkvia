import { expect, it } from "vitest";
import { changeCanvasAudioSpeedChannels, getCanvasAudioSpeedName } from "@/lib/canvas/audio-speed";

it.each([.1, .5, 1, 1.4, 4])("renders %sx audio with the expected duration, pitch and stereo channels", async speed => {
  const rate = 24000;
  const source = Float32Array.from({ length: rate }, (_, i) => .5 * Math.sin(2 * Math.PI * 440 * i / rate));
  const result = await changeCanvasAudioSpeedChannels([source, source.map(value => value * .5)], rate, speed);
  expect(result).toHaveLength(2);
  expect(result[0]).toHaveLength(Math.round(rate / speed));
  const start = Math.floor(result[0].length * .25), end = Math.floor(result[0].length * .75);
  let crossings = 0;
  for (let i = start + 1; i < end; i++) if (result[0][i - 1] <= 0 && result[0][i] > 0) crossings++;
  expect(crossings * rate / (end - start)).toBeGreaterThan(425);
  expect(crossings * rate / (end - start)).toBeLessThan(455);
  for (let i = start; i < end; i += 137) expect(result[1][i]).toBeCloseTo(result[0][i] * .5, 4);
  const tail = result[0].slice(Math.floor(result[0].length * .95));
  expect(tail.reduce((energy, value) => energy + value * value, 0) / tail.length).toBeGreaterThan(.01);
  if (speed === 1) expect(result[0]).toEqual(source);
});

it.each([0, .09, 4.01, NaN, Infinity])("rejects invalid speed %s", async speed => {
  await expect(changeCanvasAudioSpeedChannels([new Float32Array(2400)], 24000, speed)).rejects.toThrow();
});

it("uses the node name with the chosen speed suffix", () => {
  expect(getCanvasAudioSpeedName("刘三.mp3", 1.4)).toBe("刘三_1.4x");
  expect(getCanvasAudioSpeedName("刘三_截取", .1)).toBe("刘三_截取_0.1x");
});
