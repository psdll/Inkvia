import type { CreativeSelection } from "./types";

// Retain the existing editor node identity for saved/copied prompts.
export { MOTION_MENTION_NODE_NAME as CREATIVE_MENTION_NODE_NAME } from "./motion-token";
export const CHARACTER_SHEET_PRESET_ID = "characterSheet-0";
export const CHARACTER_SHEET_TOKEN = "[[characterSheet:characterSheet-0]]";
export const creativeToken = (id: string) => `[[${id.split("-")[0]}:${id}]]`;
export const creativeTokenPattern = () => /\[\[characterSheet:characterSheet-0\]\]/g;
// Tags of retired preset types (style, filter, motion) may still sit in saved prompts; they are removed silently.
const retiredCreativeTokenPattern = () => /\[\[(?:style|filter|motion):(?:style|filter|motion)-\d+\]\]\n?/g;
export function stripRetiredCreativeTokens(prompt: string) {
  return prompt.replace(retiredCreativeTokenPattern(), "");
}

/** Saved prompts may carry tags or card selections of retired presets; both are dropped. */
export function withLegacyCreativeTokens(prompt: string, _selection?: CreativeSelection) {
  return stripRetiredCreativeTokens(prompt);
}
