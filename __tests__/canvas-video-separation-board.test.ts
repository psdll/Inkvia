// @vitest-environment ./__tests__/jsdom-no-canvas-environment.ts
import { it, vi } from 'vitest';
import { verifyVideoSeparation, verifyVideoSeparationBackground } from './helpers/canvas-board-contract-harness';
vi.mock('@/lib/canvas/video-separation', async original => ({ ...await original<any>(), separateCanvasVideo: vi.fn(async () => ({ audio: new Blob(['audio'], { type: 'audio/mp4' }), video: new Blob(['video'], { type: 'video/mp4' }), width: 834, height: 1112, durationSeconds: 15 })) }));
it.each(['video', 'videoTask'] as const)('separates %s into two named persistent connected media nodes', kind => verifyVideoSeparation(kind));
it.each(['upload', 'abort', 'changed'] as const)('adds neither node after %s failure', failure => verifyVideoSeparation('video', failure));

it.each(['vocals', 'background'] as const)('extracts %s with the right name and silent video', mode => verifyVideoSeparation('video', undefined, mode));
it.each(['tracks', 'vocals', 'background'] as const)('finishes %s after deselecting the source and prevents duplicate submission', verifyVideoSeparationBackground);
