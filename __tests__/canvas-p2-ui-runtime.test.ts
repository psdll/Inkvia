import { describe, it } from 'vitest';
import { verifyMaterialToolbar, verifyInlineAudio, verifyTaskWorkspace, verifyAvailableVideoModel, verifyPreviewNavigation } from './helpers/canvas-ui-contract-harness';

describe('P2 rendered canvas contracts', () => {
it.each(['image', 'video', 'imageTask', 'videoTask'])('keeps one icon-only preview as the last %s toolbar action', verifyMaterialToolbar);
it.each(['audio', 'audioTask'])('keeps %s playback inline with download and no image preview action', verifyInlineAudio);
it.each([['imageTask', 'image'], ['videoTask', 'video'], ['audioTask', 'audio'], ['llm', 'text']])('renders a typed empty result for %s and its task panel on demand', verifyTaskWorkspace);
it('shows an enabled video-model choice while the current selection is invalid', verifyAvailableVideoModel);
it.each([1, 2])('shows navigation and position only when preview has multiple items (count %i)', verifyPreviewNavigation);
});
