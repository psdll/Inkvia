import { it } from 'vitest';
import { verifyVideoClipExport } from './helpers/canvas-board-contract-harness';
it.each(['video', 'videoTask'] as const)('exports an actual named connected clip from %s', kind => verifyVideoClipExport(kind));
it('does not add a node when uploading the video clip fails', () => verifyVideoClipExport('video', true));

it.each(['video', 'videoTask'] as const)('exports a connected crop from %s with matching file name', kind => verifyVideoClipExport(kind, false, 'crop'));
