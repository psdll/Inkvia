import { verifyReferenceLimit } from './helpers/canvas-board-contract-harness';
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getCanvasImageModelParams } from "@/lib/canvas/image-task";
import { IMAGE_TOOL_MODELS } from "@/lib/generation/task-input-schema";
import { REAPI_GPT_IMAGE_2_MODEL_ID } from "@/lib/gpt-image-2-official";
import { AICOMING_HAIYA_GPT_IMAGE_2_MODEL_ID } from "@/lib/aicoming-merchant-models";

function read(path: string) {
  return readFileSync(path, "utf8");
}

describe("GPT-Image-2 official product entry points", () => {
  it("aligns the image page parameters and reference limit for both models", () => {
    const page = read("app/image/image-tool.tsx");

    expect(page).toContain("REAPI_GPT_IMAGE_2_MODEL_ID");
    expect(page).toContain("AICOMING_HAIYA_GPT_IMAGE_2_MODEL_ID");
    expect(page).toContain("REAPI_GPT_IMAGE_2_RATIOS");
    expect(page).toContain("AICOMING_HAIYA_GPT_IMAGE_2_RATIOS");
    expect(page).toContain("isGptImage2OfficialSizeComboValid");
    expect(page).toContain("isReapiGptImage2Selected");
    expect(page).toContain("isAicomingHaiyaGptImage2Selected");
    expect(page).toContain("submittedOutputCount");
    expect(page).toContain('form.set("n", submittedOutputCount)');
    expect(page).toContain("isGptImage2OfficialProviderSelected ? 16");
  });

  it("exposes the exact Canvas quality, resolution and provider-specific ratio capabilities", () => {
    const reapi = getCanvasImageModelParams(REAPI_GPT_IMAGE_2_MODEL_ID, "4K", "1:1");
    const aicoming = getCanvasImageModelParams(AICOMING_HAIYA_GPT_IMAGE_2_MODEL_ID, "2K", "1:1");
    const aicoming1k = getCanvasImageModelParams(AICOMING_HAIYA_GPT_IMAGE_2_MODEL_ID, "1K", "1:1");

    expect(reapi.defaultResolution).toBe("2K");
    expect(reapi.defaultQuality).toBe("medium");
    expect(reapi.qualities.map((option) => option.value)).toEqual(["low", "medium", "high"]);
    expect(reapi.aspectRatios.find((option) => option.value === "auto")?.disabled).toBe(true);
    expect(reapi.aspectRatios.find((option) => option.value === "1:1")?.disabled).toBe(true);
    expect(reapi.aspectRatios.find((option) => option.value === "16:9")?.disabled).toBe(false);
    expect(aicoming.aspectRatios.some((option) => option.value === "auto")).toBe(false);
    expect(aicoming.aspectRatios.map((option) => option.value)).toEqual(expect.arrayContaining(["3:2", "2:3"]));
    expect(aicoming1k.aspectRatios.some((option) => option.value === "3:2" || option.value === "2:3")).toBe(false);
    expect(aicoming.resolutions.find((option) => option.value === "4K")?.disabled).toBe(true);
  });

  it("removes reAPI from Agent validation and tool documentation while keeping Haiya", () => {

    expect(IMAGE_TOOL_MODELS).not.toContain(REAPI_GPT_IMAGE_2_MODEL_ID);
    expect(IMAGE_TOOL_MODELS).toContain(AICOMING_HAIYA_GPT_IMAGE_2_MODEL_ID);
  });

  it("adds both models to inspiration and both isolated batch workspaces", () => {
    const inspiration = read("components/admin/InspirationTemplatesPanel.tsx");
    const settings = read("components/batch-workbench/batch-settings-panel.tsx");
    const workbench = read("components/batch-workbench/batch-workbench-page.tsx");

    expect(inspiration).toContain('"gpt-image-2-official-reapi"');
    expect(inspiration).toContain('"gpt-image-2-aicoming-haiya"');
    expect(settings).toContain("getGptImage2OfficialBatchOptions");
    expect(settings).toContain("isGptImage2OfficialProviderModel(batchModel) ? 16 : undefined");
    expect(workbench).toContain('batch.mode === "style_replication"');
    expect(workbench).toContain('batch.mode === "multi_prompt"');
  });

  it("rejects more than sixteen Canvas reference images before submission", async () => {

    await verifyReferenceLimit("gpt-image-2-official-reapi");
  });
});
