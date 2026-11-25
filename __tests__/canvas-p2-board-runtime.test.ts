import { describe, it } from 'vitest';
import { verifyReferenceLimit, verifyContextCreation, verifyDragMerge, verifyConnectedTaskPanel, verifyOutpaint } from './helpers/canvas-board-contract-harness';

describe('P2 canvas behavior replacing source-shape assertions', () => {
it.each(['success', 'late-success', 'late-failure'] as const)('keeps outpaint upload owned by its editing session: %s', verifyOutpaint);
it.each(['gpt-image-2-apimart', 'gpt-image-2.5-apimart'])("enforces sixteen references before saving or submitting for %s", verifyReferenceLimit);
it.each(['imageTask', 'videoTask', 'audioTask', 'llm'])("creates %s at the requested context-menu position without submitting", verifyContextCreation);
it('keeps active drag coordinates when a business update arrives', verifyDragMerge);
it.each(['imageTask', 'videoTask', 'llm'])('opens the new %s panel from a material connection and suppresses it on multiselect', verifyConnectedTaskPanel);
});
