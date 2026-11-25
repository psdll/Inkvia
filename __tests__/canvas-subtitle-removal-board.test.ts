// @vitest-environment ./__tests__/jsdom-no-canvas-environment.ts
import { it } from 'vitest';
import { verifySubtitleRemovalTask, verifyConcurrentSubtitleRemoval } from './helpers/canvas-board-contract-harness';
it.each(['success', 'failure', 'cancel-before-queued'] as const)('keeps subtitle task nodes consistent through %s', verifySubtitleRemovalTask);

it('submits and polls independent subtitle jobs and cancels only the selected job', () => verifyConcurrentSubtitleRemoval());
it('resumes every active subtitle run after reopening and accepts more work', () => verifyConcurrentSubtitleRemoval(true));
