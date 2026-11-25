import { readChineseUiSource as readFileSync } from "./helpers/chinese-ui-source";
import { describe, expect, it } from "vitest";
import { isSeedance20VideoModel } from "@/lib/sora2";
import { partitionToolMediaInputs } from "@/lib/tool-media/client-draft";
import { generationReferenceFormat } from "@/lib/generation/prompt-references";

const firstId = "11111111-1111-4111-8111-111111111111";
const secondId = "22222222-2222-4222-8222-222222222222";

describe("video multimodal reference ordering", () => {
  it("enables the existing swap interaction only on the multimodal upload box", () => {
    const source = readFileSync("app/video/video-tool.tsx", "utf8");
    const multimodalSection = source.match(
      /<MultiUploadDropzone\s+title="上传素材"[\s\S]*?\/>/,
    )?.[0];

    expect(multimodalSection).toBeDefined();
    expect(multimodalSection).toContain("replaceOnItemDrop");
  });

  it("uses ordinal prompt references for Seedance 2.0 and MiniMax-H3", () => {
    expect(generationReferenceFormat("video", "doubao-seedance-2-0-260128")).toBe("ordinal");
    expect(generationReferenceFormat("video", "minimax-h3")).toBe("ordinal");
  });

  it.each([
    "doubao-seedance-2-0-260128",
    "doubao-seedance-2-0-fast-260128",
    "doubao-seedance-2-0-mini-260615",
    "doubao-seedance-2.0-face",
    "doubao-seedance-2.0-fast-face",
  ])("recognizes %s as a Seedance 2.0 family model", (model) => {
    expect(isSeedance20VideoModel(model)).toBe(true);
  });

  it.each([
    "doubao-seedance-2-5-260628",
    "MiniMax-H3",
    "grok-imagine-video",
  ])("keeps %s outside Seedance 2.0 family detection", (model) => {
    expect(isSeedance20VideoModel(model)).toBe(false);
  });

  it("serializes the reordered array as backend manifest positions", () => {
    expect(
      partitionToolMediaInputs([
        { mediaId: secondId, file: null, url: "/uploads/tool_inputs/second.png" },
        { mediaId: firstId, file: null, url: "/uploads/tool_inputs/first.png" },
      ]),
    ).toEqual({
      manifest: {
        version: 1,
        items: [
          { position: 0, source: "tool_media", mediaId: secondId },
          { position: 1, source: "tool_media", mediaId: firstId },
        ],
      },
      toolMediaIds: [secondId, firstId],
      legacyPaths: [],
    });
  });
});
