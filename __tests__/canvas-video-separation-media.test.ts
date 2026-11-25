import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Input, BufferSource, ALL_FORMATS, EncodedPacketSink, type InputTrack } from 'mediabunny';
import { afterEach, expect, it, vi } from 'vitest';
import { separateCanvasVideo } from '@/lib/canvas/video-separation';
afterEach(() => vi.unstubAllGlobals());
async function packets(track: InputTrack) {
  const values = [];
  for await (const packet of new EncodedPacketSink(track).packets()) values.push({ hash: createHash('sha256').update(packet.data).digest('hex'), duration: packet.duration });
  return values;
}
// The old fixture was a third-party preset video and has been removed; add an owned H264/AAC clip here to re-enable.
const fixture = 'public/canvas-creative-presets/motions/motion-645.mp4';
it.skipIf(!existsSync(fixture))('separates real H264/AAC media without losing or reencoding packets', async () => {
  const source = await readFile(fixture);
  vi.stubGlobal('fetch', vi.fn(async () => new Response(source)));
  const result = await separateCanvasVideo('/test.mp4');
  const original = new Input({ source: new BufferSource(source), formats: ALL_FORMATS });
  const audio = new Input({ source: new BufferSource(await result.audio.arrayBuffer()), formats: ALL_FORMATS });
  const video = new Input({ source: new BufferSource(await result.video.arrayBuffer()), formats: ALL_FORMATS });
  try {
    expect((await audio.getTracks()).map(track => track.type)).toEqual(['audio']);
    expect((await video.getTracks()).map(track => track.type)).toEqual(['video']);
    const sourceVideo = (await original.getPrimaryVideoTrack())!, sourceAudio = (await original.getPrimaryAudioTrack())!;
    const outputVideo = (await video.getPrimaryVideoTrack())!, outputAudio = (await audio.getPrimaryAudioTrack())!;
    expect([outputVideo.displayWidth, outputVideo.displayHeight]).toEqual([sourceVideo.displayWidth, sourceVideo.displayHeight]);
    expect(await packets(outputVideo)).toEqual(await packets(sourceVideo));
    expect(await packets(outputAudio)).toEqual(await packets(sourceAudio));
    expect(await video.computeDuration()).toBeCloseTo(await sourceVideo.computeDuration(), 2);
    expect(await audio.computeDuration()).toBeCloseTo(await sourceAudio.computeDuration(), 2);
  } finally { original.dispose(); audio.dispose(); video.dispose(); }
});
