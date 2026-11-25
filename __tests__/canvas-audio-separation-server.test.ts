import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const mocks = vi.hoisted(() => ({ exec: vi.fn(), access: vi.fn(), rm: vi.fn(), write: vi.fn(), auth: vi.fn() }));
vi.mock('node:child_process', () => ({ execFile: mocks.exec }));
vi.mock('node:fs/promises', () => ({ default: {
  access: mocks.access, mkdir: vi.fn(), mkdtemp: vi.fn(async () => '/uploads/job'), writeFile: mocks.write,
  readFile: vi.fn(async () => Buffer.from('RIFF-wave')), rm: mocks.rm,
} }));
vi.mock('@/lib/storage', () => ({ resolveLocalUploadDirectory: () => '/uploads' }));
vi.mock('@/lib/server-auth', () => ({ getUserId: mocks.auth }));
import { readSeparationAudio, extractCanvasAudioStem, MAX_SEPARATION_AUDIO_BYTES } from '@/lib/canvas/audio-separation-server';
import { POST } from '@/app/api/canvas/audio-separation/route';
const request = (stem = 'vocals') => new NextRequest(`http://localhost/api/canvas/audio-separation?stem=${stem}`, { method: 'POST', body: 'audio' });
beforeEach(() => { vi.clearAllMocks(); mocks.rm.mockResolvedValue(undefined); mocks.auth.mockResolvedValue(1); mocks.access.mockResolvedValue(undefined); mocks.exec.mockImplementation((_cmd, _args, _options, done) => done(null)); });
afterEach(() => vi.unstubAllGlobals());
it('requires login and validates the requested stem before processing', async () => {
  mocks.auth.mockResolvedValueOnce(null);
  expect((await POST(request())).status).toBe(401);
  expect((await POST(request('invalid'))).status).toBe(400);
  expect(mocks.exec).not.toHaveBeenCalled();
});
it.each(['vocals', 'background'])('returns real WAV bytes and cleans up %s temporary files', async stem => {
  const response = await POST(request(stem));
  expect(response.status).toBe(200); expect(response.headers.get('content-type')).toBe('audio/wav');
  expect(await response.text()).toBe('RIFF-wave');
  expect(mocks.exec.mock.calls[0][1]).toEqual(expect.arrayContaining(['--stem', stem]));
  expect(mocks.exec.mock.calls[0][2].signal).toBeUndefined();
  expect(mocks.rm).toHaveBeenCalledWith('/uploads/job', { recursive: true, force: true });
});
it('limits input size while streaming and rejects empty audio', async () => {
  await expect(readSeparationAudio(new Request('http://localhost', { method: 'POST' }))).rejects.toThrow('有效');
  const cancel = vi.fn();
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(MAX_SEPARATION_AUDIO_BYTES + 1)); }, cancel });
  await expect(readSeparationAudio({ body: stream } as Request)).rejects.toThrow('32 MB');
  expect(cancel).toHaveBeenCalled();
});
it('retains work independently of request abort, rejects concurrency and releases the lock after errors', async () => {
  let finish!: (error: any) => void;
  mocks.exec.mockImplementationOnce((_cmd, _args, _options, done) => { finish = done; });
  const controller = new AbortController();
  const pending = extractCanvasAudioStem(new Request('http://localhost', { method: 'POST', body: 'audio', signal: controller.signal }), 1, 'vocals');
  await vi.waitFor(() => expect(mocks.exec).toHaveBeenCalled());
  controller.abort();
  await expect(extractCanvasAudioStem(request(), 1, 'background')).rejects.toThrow('正在提取');
  finish(new Error('engine failed'));
  await expect(pending).rejects.toThrow('音源分离失败');
  expect(mocks.rm).toHaveBeenCalled();
  await expect(extractCanvasAudioStem(request(), 1, 'background')).resolves.toBeInstanceOf(Buffer);
});
it('reports a missing engine without starting inference', async () => {
  mocks.access.mockRejectedValueOnce(new Error('missing'));
  const response = await POST(request());
  expect(response.status).toBe(422); expect((await response.json()).error).toContain('尚未安装');
  expect(mocks.exec).not.toHaveBeenCalled();
});
