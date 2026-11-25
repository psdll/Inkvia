import sharp from "sharp";
import { beforeEach, it, expect, vi } from "vitest";
const mocks = vi.hoisted(() => ({ save: vi.fn(async () => '/uploads/card.webp') }));
vi.mock('@/lib/storage', () => ({ saveBufferFile: mocks.save }));
beforeEach(() => mocks.save.mockClear());
it('preserves a small original without upscaling or adding padding', async () => {
  const library = await import('@/lib/media-library-thumbnails');
  expect(library).toHaveProperty('createMaterialCardThumbnail');
  const input = await sharp({ create: { width: 800, height: 1200, channels: 3, background: '#123456' } }).png().toBuffer();
  const result = await library.createMaterialCardThumbnail(input, { folder: 'materials', kind: 'image' });
  expect(result).toEqual({ url: '/uploads/card.webp', width: 800, height: 1200 });
  const image = await sharp((mocks.save.mock.calls[0] as any)[0]).metadata();
  expect(image).toMatchObject({ width: 800, height: 1200, format: 'webp' });
});

it.each([[1800, 2400, 1600], [2400, 1600, 800]])('creates a 1200px wide card thumbnail from a %s x %s original', async (width, height, outputHeight) => {
  const library = await import('@/lib/media-library-thumbnails');
  const input = await sharp({ create: { width, height, channels: 3, background: '#123456' } }).png().toBuffer();
  const result = await library.createMaterialCardThumbnail(input, { folder: 'materials', kind: 'image' });
  expect(result).toEqual({ url: '/uploads/card.webp', width: 1200, height: outputHeight });
  const [buffer, , options] = mocks.save.mock.calls[0] as any;
  expect(await sharp(buffer).metadata()).toMatchObject({ width: 1200, height: outputHeight, format: 'webp' });
  expect(options.fileName).toMatch(/-card-1200\.webp$/);
});
