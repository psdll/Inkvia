// @vitest-environment ./__tests__/jsdom-no-canvas-environment.ts
import { it } from 'vitest';
import { verifyIdleWheelRecovery, verifyWheelRecoveryLifecycle } from './helpers/canvas-board-contract-harness';

it.each([.1, .5, 1, 2])('restores first-click glow and connector hit targets after one wheel tick and idle at zoom %s', verifyIdleWheelRecovery);
it.each(['continuous', 'mouse pan', 'programmatic zoom', 'blur', 'hidden', 'Escape', 'pointercancel', 'unmount'])('settles wheel input without interrupting %s', verifyWheelRecoveryLifecycle);
