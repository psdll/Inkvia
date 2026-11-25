import { it } from "vitest";
import { verifyAudioClipExport } from "./helpers/canvas-board-contract-harness";

it.each(["audio", "audioTask"] as const)("creates a named, connected clip from %s without changing its source", kind => verifyAudioClipExport(kind));
it("keeps the canvas unchanged if the clip upload fails", () => verifyAudioClipExport("audio", true));
it.each(["audio", "audioTask"] as const)("creates a connected speed result from %s with the rate in its filename", kind => verifyAudioClipExport(kind, false, 1.4));
