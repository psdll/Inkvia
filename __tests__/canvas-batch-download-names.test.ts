import { it } from 'vitest';
import { verifyCanvasBatchDownloadNames } from './helpers/canvas-board-contract-harness';

it.each(['rerun', 'same-name', 'multiple-outputs', 'renamed-group', 'latest-failed', 'renamed-task', 'renamed-media'] as const)('downloads current results without changing node filenames: %s', verifyCanvasBatchDownloadNames);
