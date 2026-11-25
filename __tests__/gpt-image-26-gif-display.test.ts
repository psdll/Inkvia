import { describe, expect, it } from "vitest";
import { createGenerationDisplayAssetPatch, getGenerationDisplayFields } from "@/lib/generation-display-assets";

describe("generated GIF display", () => {
  const source = "/uploads/image-edit-results/animated.gif";
  it("keeps the original animation instead of generating a single-frame preview", async () => {
    expect(await createGenerationDisplayAssetPatch({ type: "image_edit", localPath: source })).toMatchObject({
      outputDisplayUrl: source, outputPreviewUrl: source, outputOriginalUrl: source,
    });
  });
  it("ignores stale static preview metadata when opening an animation", () => {
    expect(getGenerationDisplayFields({ localPath: source, templateData: { outputDisplayUrl: "/uploads/old.webp", outputPreviewUrl: "/uploads/old.webp" } }))
      .toMatchObject({ displayKind: "image", displayUrl: source, previewUrl: source });
  });
});
