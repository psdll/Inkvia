// Stable inline references survive canvas save/load, copy/paste and prompt edits.
export const MOTION_MENTION_NODE_NAME = "motionMention";
export const motionToken = (id: string) => `[[motion:${id}]]`;
export const motionTokenPattern = () => /\[\[motion:(motion-\d+)\]\]/g;
