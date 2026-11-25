import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  AICOMING_HAIYA_GPT_IMAGE_2_MODEL_ID,
} from "@/lib/aicoming-merchant-models";
import { IMAGE_TOOL_MODELS } from "@/lib/generation/task-input-schema";
import { getCanvasImageModelParams } from "@/lib/canvas/image-task";

function read(path: string) {
  return readFileSync(path, "utf8");
}

describe("AIComing merchant image product entry points", () => {
  it("aligns Canvas parameters with the existing GPT-Image-2 family", () => {
    const haiya = getCanvasImageModelParams(AICOMING_HAIYA_GPT_IMAGE_2_MODEL_ID, "2K", "16:9");

    expect(haiya.qualities.map((option) => option.value)).toEqual(["low", "medium", "high"]);
    expect(haiya.resolutions.map((option) => option.value)).toEqual(["1K", "2K", "4K"]);
    expect(haiya.aspectRatios.map((option) => option.value)).toContain("16:9");
  });

  it("exposes Haiya to Agent, image page, inspirations and both batch modes", () => {
    expect(IMAGE_TOOL_MODELS).toContain(AICOMING_HAIYA_GPT_IMAGE_2_MODEL_ID);

    const imagePage = read("app/image/image-tool.tsx");
    const inspiration = read("components/admin/InspirationTemplatesPanel.tsx");
    const batch = read("components/batch-workbench/batch-settings-panel.tsx");

    expect(imagePage).toContain(AICOMING_HAIYA_GPT_IMAGE_2_MODEL_ID);
    expect(inspiration).toContain(AICOMING_HAIYA_GPT_IMAGE_2_MODEL_ID);
    expect(batch).toContain("isGptImage2OfficialProviderModel");
  });

  it("routes Haiya through async submission and finalizer polling", () => {
    const service = read("lib/generation/image-service.ts");
    const finalize = read("lib/generation/finalize.ts");

    expect(service).toContain("aicomingHaiyaSubmitImage");
    expect(service).toContain('isAicomingHaiyaGptImage2 ? "aicoming-haiya"');
    expect(finalize).toContain('"aicoming-haiya"');
    expect(finalize).toContain("aicomingHaiyaGetImageTask");
  });
});
