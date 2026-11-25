import { readChineseUiSource as readFileSync } from "./helpers/chinese-ui-source";
import { describe, expect, it } from "vitest";
import {
  MIDJOURNEY_V8_MODEL_ID,
  MIDJOURNEY_V8_RATIOS,
  MIDJOURNEY_V8_UPSTREAM_MODEL,
  buildReapiMidjourneyV8Request,
  extractReapiMidjourneyTaskId,
} from "@/lib/reapi-midjourney-v8";
import { IMAGE_EDIT_MODEL_DEFINITIONS } from "@/lib/toolbox-models";
import {
  getBuiltinProviders,
  mergeSavedProvidersWithBuiltins,
} from "@/lib/providers/registry";

function read(path: string) {
  return readFileSync(path, "utf8");
}

describe("reAPI Midjourney V8.2 contract", () => {
  it("registers the exact local label and upstream capability without replacing saved reAPI settings", () => {
    expect(IMAGE_EDIT_MODEL_DEFINITIONS).toContainEqual(expect.objectContaining({
      id: MIDJOURNEY_V8_MODEL_ID,
      label: "Midjourney-V8.2",
      provider: "reapi",
      upstreamModelId: MIDJOURNEY_V8_UPSTREAM_MODEL,
    }));

    const builtin = getBuiltinProviders().find((provider) => provider.id === "reapi")!;
    expect(builtin.imageModels).toEqual(expect.arrayContaining([
      "gpt-image-2.5-flare-official",
      "gpt-image-2.5-sunburst-official",
      MIDJOURNEY_V8_UPSTREAM_MODEL,
    ]));

    const merged = mergeSavedProvidersWithBuiltins([{
      ...builtin,
      imageModels: ["gpt-image-2-official"],
      apiKey: "saved-key",
      enabled: true,
    }]);
    expect(merged.find((provider) => provider.id === "reapi")).toMatchObject({
      apiKey: "saved-key",
      enabled: true,
      imageModels: expect.arrayContaining([
        "gpt-image-2.5-flare-official",
        "gpt-image-2.5-sunburst-official",
        MIDJOURNEY_V8_UPSTREAM_MODEL,
      ]),
    });
  });

  it("submits text-to-image as one fixed V8.2 imagine request without count or advanced fields", () => {
    expect(buildReapiMidjourneyV8Request({
      prompt: " cinematic mountain ",
      aspectRatio: "16:9",
      speed: "fast",
    })).toEqual({
      endpoint: "/images/generations",
      body: {
        model: "midjourney",
        action: "imagine",
        prompt: "cinematic mountain",
        version: "8.2",
        size: "16:9",
        speed: "fast",
      },
    });
  });

  it("submits reference editing as one fixed V8.2 edits request and keeps reference order", () => {
    const request = buildReapiMidjourneyV8Request({
      prompt: "replace the background",
      aspectRatio: "9:16",
      speed: "turbo",
      imageUrls: [
        " https://cdn.test/first.png ",
        "https://cdn.test/second.png",
      ],
    });

    expect(request.body).toEqual({
      model: "midjourney",
      action: "edits",
      prompt: "replace the background",
      version: "8.2",
      size: "9:16",
      speed: "turbo",
      image_urls: [
        "https://cdn.test/first.png",
        "https://cdn.test/second.png",
      ],
    });
    expect(request.body).not.toHaveProperty("n");
    expect(request.body).not.toHaveProperty("quality");
    expect(request.body).not.toHaveProperty("resolution");
  });

  it("supports every displayed ratio, defaults speed safely, and accepts both documented task id envelopes", () => {
    expect(MIDJOURNEY_V8_RATIOS).toEqual([
      "1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "2:1", "1:2", "21:9", "9:21",
    ]);
    expect(buildReapiMidjourneyV8Request({ prompt: "x", speed: "unknown" }).body)
      .toMatchObject({ version: "8.2", size: "1:1", speed: "relax" });
    expect(extractReapiMidjourneyTaskId({ id: "task-top" })).toBe("task-top");
    expect(extractReapiMidjourneyTaskId({ data: [{ task_id: "task-nested" }] })).toBe("task-nested");
  });
});

describe("Midjourney V8.2 image product integration", () => {
  it("keeps Midjourney excluded from both batch model refresh paths", () => {
    const batchPage = read("components/batch-workbench/batch-workbench-page.tsx");

    expect(batchPage.match(/model\.id !== "midjourney-v8-reapi"/g)).toHaveLength(2);
  });

  it("shows ratio, the shared Midjourney settings (speed and advanced options), and a fixed four-image label", () => {
    const page = read("app/image/image-tool.tsx");

    expect(page).toContain("MIDJOURNEY_V8_MODEL_ID");
    expect(page).toContain("MIDJOURNEY_V8_RATIOS");
    expect(page).toContain("isMidjourneyV8Selected");
    expect(page).toContain("<MidjourneySettings");
    expect(page).toContain('form.set("midjourneyOptions", JSON.stringify(midjourneyOptions))');
    expect(page).toContain("imageCountLabel(4)");
    expect(page).not.toContain("4张（固定）");
    expect(page).toContain('form.set("speed", midjourneySpeed)');
    expect(page).toContain("isMidjourneyV8Selected ? 1 : outputQuantity");
  });

  it("routes both prompt-only and reference editing through the dedicated async adapter", () => {
    const service = read("lib/generation/image-service.ts");

    expect(service).toContain("reapiSubmitMidjourneyV8");
    expect(service).toContain("isMidjourneyV8Model");
    expect(service).toContain("imageUrls: uploadedUrls");
    expect(service).toContain("outputCount: MIDJOURNEY_V8_OUTPUT_COUNT");
    expect(service).toContain('unitType: "request"');
    expect(service).toContain('isMidjourneyV8 ? "reapi"');
    expect(service).toContain("isMidjourneyV8Model(input.model)");
    expect(service).toContain("? 1");
  });
});
