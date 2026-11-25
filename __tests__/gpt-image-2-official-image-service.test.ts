import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("GPT-Image-2 official image service integration", () => {
  it("submits both local models as provider-owned async tasks with one upstream output", () => {
    const service = readFileSync("lib/generation/image-service.ts", "utf8");

    expect(service).toContain("reapiSubmitImage");
    expect(service).toContain("aicomingHaiyaSubmitImage");
    expect(service).toContain("isReapiGptImage2");
    expect(service).toContain("isAicomingHaiyaGptImage2");
    expect(service).toContain('isTuziGptImage2 ? "tuzi"');
    expect(service).toContain('(isReapiGptImage2 || isReapiGptImage25) ? "reapi"');
    expect(service).toContain('isAicomingHaiyaGptImage2 ? "aicoming-haiya"');
    expect(service).toContain("if (isReapiGptImage2 || isAicomingHaiyaGptImage2 || isReapiGptImage25)");
    expect(service).toContain("uploadedUrls.length > 16");
    expect(service).toContain("n: 1");
    expect(service).toContain("requestKey: input.requestKey");
    expect(service).toContain('providerStatus: "submitted"');
    expect(service).toContain('return { generationId: record.id, taskId: submitted.taskId, status: "running" };');
  });

  it("keeps project quantity fan-out separate from the provider n value", () => {
    const service = readFileSync("lib/generation/image-service.ts", "utf8");
    const batchStart = service.indexOf("export async function createImageGenerationBatch");
    const batchSource = service.slice(batchStart);

    expect(batchSource).toContain("runImageTaskBatch(taskCount");
    expect(batchSource).toContain("deriveImageTaskRequestKey(input.requestKey, batchIndex)");
  });
});
