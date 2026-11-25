import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { separateCanvasVideo, getCanvasVideoSeparationNames } from '@/lib/canvas/video-separation';
const media = vi.hoisted(() => ({ audio: true, options: [] as any[], discarded: [] as any[], dispose: vi.fn(), execute: vi.fn(), cancel: vi.fn() }));
vi.mock('mediabunny', () => ({
  Input: class { dispose = media.dispose; getPrimaryVideoTrack = async () => ({ displayWidth: 834, displayHeight: 1112 }); getPrimaryAudioTrack = async () => media.audio ? {} : null; computeDuration = async () => 15; },
  BlobSource: class {}, ALL_FORMATS: [], BufferTarget: class { buffer = new ArrayBuffer(16); }, Mp4OutputFormat: class {}, M4aOutputFormat: class {},
  Output: class { target: any; constructor(options: any) { this.target = options.target; } },
  Conversion: { init: async (options: any) => { media.options.push(options); return { isValid: true, discardedTracks: media.discarded, execute: media.execute, cancel: media.cancel }; } },
}));
beforeEach(() => { media.audio = true; media.options = []; media.discarded = []; media.execute.mockReset(); media.cancel.mockReset().mockResolvedValue(undefined); media.dispose.mockClear(); vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, blob: async () => new Blob(['source']) }))); });
afterEach(() => vi.unstubAllGlobals());
it('exports separate real file types, keeps every requested track and prefers remux without trimming', async () => {
  const result = await separateCanvasVideo('/source.mp4');
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(media.options[0]).toMatchObject({ tracks: 'all', video: { discard: true } });
  expect(media.options[1]).toMatchObject({ tracks: 'all', audio: { discard: true } });
  for (const options of media.options) { expect(options.trim).toBeUndefined(); expect(options.video?.forceTranscode).not.toBe(true); }
  expect(result).toMatchObject({ width: 834, height: 1112, durationSeconds: 15 });
  expect(result.audio.type).toBe('audio/mp4'); expect(result.video.type).toBe('video/mp4'); expect(media.dispose).toHaveBeenCalledOnce();
  expect(getCanvasVideoSeparationNames('稳哒.mp4')).toEqual({ audio: '稳哒_音轨', video: '稳哒_无声' });
});
it('rejects silent input without producing partial output', async () => { media.audio = false; await expect(separateCanvasVideo('/silent.mp4')).rejects.toThrow('没有音轨'); expect(media.execute).not.toHaveBeenCalled(); expect(media.dispose).toHaveBeenCalled(); });
it('allows deliberate removal but rejects unexpected lost tracks', async () => {
  media.discarded = [{ reason: 'discarded_by_user' }]; await separateCanvasVideo('/source.mp4');
  media.discarded = [{ reason: 'no_encodable_target_codec' }]; await expect(separateCanvasVideo('/source.mp4')).rejects.toThrow('完整');
});
it('surfaces HTTP and conversion errors and releases input', async () => {
  vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status: 503 } as Response); await expect(separateCanvasVideo('/source.mp4')).rejects.toThrow('503');
  media.execute.mockRejectedValueOnce(new Error('处理失败')); await expect(separateCanvasVideo('/source.mp4')).rejects.toThrow('处理失败'); expect(media.dispose).toHaveBeenCalled();
});
it('stops between outputs on cancellation', async () => {
  const controller = new AbortController(); media.execute.mockImplementationOnce(async () => controller.abort());
  await expect(separateCanvasVideo('/source.mp4', undefined, controller.signal)).rejects.toThrow();
  expect(media.options).toHaveLength(1); expect(media.dispose).toHaveBeenCalled();
});
