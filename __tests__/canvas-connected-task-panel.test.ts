import { verifyAudioConnection, verifyConnectedTaskPanel, verifyVideoReferenceModes } from './helpers/canvas-board-contract-harness';
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

describe("connected task panel", () => {
  it("synchronizes video modes on load, model changes, connections and removals", verifyVideoReferenceModes);
  it("opens image, video, and LLM task panels when they are created from a material connection", async () => {

    for (const kind of ["imageTask", "videoTask", "llm"]) await verifyConnectedTaskPanel(kind);
  });
  it.each(['image', 'audio', 'audioTask', 'imageTask'] as const)("creates a compatible audio task from %s and retains its references", async (kind) => {
    await verifyAudioConnection(kind);
  });
  it.each(['speech-2.8-hd', 'seed-audio-1.0'])("preserves the preferred %s model for text connections", async (model) => {
    await verifyAudioConnection('prompt', true, model);
  });
  it.each(['image', 'audio'] as const)("does not enable %s references when Seed Audio is unavailable, even with saved Seed preferences", async (kind) => {
    await verifyAudioConnection(kind, false, 'seed-audio-1.0');
  });
  it("keeps video references unavailable for audio generation", async () => {
    await verifyAudioConnection('video');
  });
});
