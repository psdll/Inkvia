// @vitest-environment ./__tests__/jsdom-no-canvas-environment.ts
import { it } from 'vitest';
import { verifyLlmMediaSubmission } from './helpers/canvas-board-contract-harness';
it('submits original connected image, video and audio references in order', verifyLlmMediaSubmission);
