import { verifyReferenceLimit } from './helpers/canvas-board-contract-harness';
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createImageTaskSchema, IMAGE_TOOL_MODELS } from "@/lib/generation/task-input-schema";
import { getCanvasImageModelParams } from "@/lib/canvas/image-task";

const MODEL_ID = "gpt-image-2-tuzi";

function read(path: string) {
  return readFileSync(path, "utf8");
}

describe("TuZi GPT-Image-2 product entry points", () => {
  it("wires the independent synchronous adapter into image generation", () => {
    const service = read("lib/generation/image-service.ts");

    expect(service).toContain("tuziGenerateImage");
    expect(service).toContain("isTuziGptImage2Model");
    expect(service).toContain('isTuziGptImage2 ? "tuzi"');
    expect(service).toContain("isTuziGptImage2 && imagePaths.length > 16");
    expect(service).toContain("maskUrl: input.maskUrl");
    expect(service).toContain("orderedInputs.map((media) => isTuziGptImage2 ? media.localPath : media.modelUrl)");
    expect(service).toContain("referenceImageCount: imagePaths.length");
    expect(service).toContain("n: 1");
    expect(service).toContain('return { generationId: record.id, taskId: String(record.id), status: "running" };');
  });

  it("exposes only the new model parameters and sixteen references on the image page", () => {
    const page = read("app/image/image-tool.tsx");

    expect(page).toContain("TUZI_GPT_IMAGE_2_MODEL_ID");
    expect(page).toContain("TUZI_GPT_IMAGE_2_ASPECT_RATIOS");
    expect(page).toContain("isTuziGptImage2SizeComboValid");
    expect(page).toContain("isTuziGptImage2Selected");
    expect(page).toContain("isTuziGptImage2Selected ? 16");
    expect(page).toContain("isTuziGptImage2Selected ? \"1\"");
  });

  it("provides Canvas ratios, quality and legal 4K combinations", () => {
    const params2k = getCanvasImageModelParams(MODEL_ID, "2K", "1:1");
    const params4k = getCanvasImageModelParams(MODEL_ID, "4K", "1:1");

    expect(params2k.defaultResolution).toBe("2K");
    expect(params2k.defaultQuality).toBe("medium");
    expect(params2k.qualities.map((option) => option.value)).toEqual(["low", "medium", "high"]);
    expect(params2k.aspectRatios.map((option) => option.value)).toEqual(expect.arrayContaining([
      "auto", "1:1", "3:2", "2:3", "16:9", "9:16",
    ]));
    expect(params4k.aspectRatios.some((option) => option.value === "1:1")).toBe(false);
    expect(params4k.aspectRatios.some((option) => option.value === "16:9")).toBe(true);
  });

  it("rejects a seventeenth Canvas reference without changing official-provider messages", async () => {

    await verifyReferenceLimit("gpt-image-2-tuzi");
  });

  it("adds TuZi options and limits to both isolated batch modes", () => {
    const settings = read("components/batch-workbench/batch-settings-panel.tsx");

    expect(settings).toContain("getTuziGptImage2BatchOptions");
    expect(settings).toContain("normalizeTuziGptImage2BatchSettings");
    expect(settings).toContain("isTuziGptImage2Model(batchModel) ? 16");
    expect(settings).toContain('batch.mode === "multi_prompt"');
    expect(settings).toContain('batch.mode === "style_replication"');
  });

  it("accepts TuZi in Agent with ten local tasks and sixteen ordered references", () => {
    expect(IMAGE_TOOL_MODELS).toContain(MODEL_ID);
    expect(createImageTaskSchema.parse({
      prompt: "compose",
      model: MODEL_ID,
      count: 10,
      imagePaths: Array.from({ length: 16 }, (_, index) => `uploads/${index + 1}.png`),
    })).toMatchObject({ model: MODEL_ID, count: 10 });
    expect(() => createImageTaskSchema.parse({
      prompt: "too many",
      model: MODEL_ID,
      imagePaths: Array.from({ length: 17 }, (_, index) => `uploads/${index + 1}.png`),
    })).toThrow();

  });

  it("adds inspiration parameters but no unconfirmed default price", () => {
    const inspiration = read("components/admin/InspirationTemplatesPanel.tsx");
    const priceDefaults = read("app/api/admin/billing/prices/route.ts");

    expect(inspiration).toContain('"gpt-image-2-tuzi"');
    expect(inspiration).toContain("isTuziGptImage2SizeComboValid");
    expect(priceDefaults).not.toContain('model: "gpt-image-2-tuzi"');
  });
});
