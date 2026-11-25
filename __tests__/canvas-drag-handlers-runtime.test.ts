// @vitest-environment ./__tests__/jsdom-no-canvas-environment.ts
import { it } from 'vitest';
import { verifyTextReferenceSubmission, verifyDragHandlerStability, verifyUndoViewportPersistence, verifyIsolatedSingleDrag, verifyRelatedEdgeGlow, verifyConnectionMenuDismissedOnDrag, verifyPanIgnoresStaleEnd, verifyFlowPropsDuringAlignment } from './helpers/canvas-board-contract-harness';
it('keeps the current pan active and rejects an earlier gesture end callback', verifyPanIgnoresStaleEnd);
it.each([false, true])('dismisses unchosen connection menus permanently when dragging nodes (multiple=%s)', verifyConnectionMenuDismissedOnDrag);
it('keeps relation flow through panning, zooming and dragging and resumes it on release', verifyRelatedEdgeGlow);
it('updates 60 single-node drag positions without rerendering the editor and preserves position on blur', verifyIsolatedSingleDrag);

it('keeps node and edge handlers stable across live position frames without changing stationary nodes', verifyDragHandlerStability);
it('persists the visible viewport when undoing an edit after panning and zooming', verifyUndoViewportPersistence);
it('keeps flow callbacks and options stable while live alignment guides change', verifyFlowPropsDuringAlignment);

it.each(['imageTask', 'videoTask'])('submits connected text separately and removes only its edge (%s)', verifyTextReferenceSubmission);
