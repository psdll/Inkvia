// @vitest-environment ./__tests__/jsdom-no-canvas-environment.ts
import { it } from 'vitest';
import { verifyCanvasViewToggles, verifyPersonalMaterialDrop, verifyIsolatedEdgeVisibility, verifyLegacyEdgeVisibility, verifyMultiNodeAlignment, verifySnapRelease, verifyCrossGroupAlignment } from './helpers/canvas-board-contract-harness';

it('toggles edge rendering without deleting connections, enables alignment by default, and remembers disabling snap', verifyCanvasViewToggles);
it.each([0.1, 1, 2])('keeps multiple nodes together when aligning at zoom %s and clears guides on release', verifyMultiNodeAlignment);
it.each(['release', 'blur', 'pointercancel', 'Escape', 'hidden'] as const)('retains the aligned location after %s and a late drag-end event', verifySnapRelease);
it.each([false, true])('aligns using world coordinates across parent groups (multiple=%s)', verifyCrossGroupAlignment);

it("keeps hidden edges isolated across canvases, accounts, backgrounding and server remounts", verifyIsolatedEdgeVisibility);

it("migrates legacy visibility once and respects explicit show thereafter", verifyLegacyEdgeVisibility);

it.each([false, true])("drops personal material at the exact release point after async import (inside group=%s)", verifyPersonalMaterialDrop);
