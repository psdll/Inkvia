import { describe, expect, it } from "vitest";
import {
  GenerationInputManifestError,
  assertGenerationInputManifestMatches,
  buildGenerationInputSubmission,
  interleaveGenerationInputValues,
  parseGenerationInputManifest,
} from "@/lib/generation/input-manifest";

const firstId = "11111111-1111-4111-8111-111111111111";
const secondId = "22222222-2222-4222-8222-222222222222";

describe("generation input manifest", () => {
  it("preserves the exact tool/legacy/tool UI order", () => {
    const submission = buildGenerationInputSubmission([
      { mediaId: firstId, url: "/uploads/tool_inputs/a.png" },
      { url: "/uploads/product-library/b.png" },
      { mediaId: secondId, url: "/uploads/tool_inputs/c.png" },
    ]);

    expect(submission.manifest.items.map((item) => [item.position, item.source])).toEqual([
      [0, "tool_media"],
      [1, "legacy_path"],
      [2, "tool_media"],
    ]);
    expect(submission.toolMediaIds).toEqual([firstId, secondId]);
    expect(submission.legacyPaths).toEqual(["/uploads/product-library/b.png"]);
    expect(
      interleaveGenerationInputValues(submission.manifest, ["tool-a", "tool-c"], ["legacy-b"]),
    ).toEqual(["tool-a", "legacy-b", "tool-c"]);
  });

  it("rejects a failed or unresolved visible slot with its UI position", () => {
    expect(() =>
      buildGenerationInputSubmission([
        { mediaId: firstId, url: "/uploads/tool_inputs/a.png" },
        { file: new File(["x"], "x.png"), uploadError: "network" },
      ]),
    ).toThrow("第 2 个素材上传失败");

    expect(() =>
      buildGenerationInputSubmission([{ url: "/uploads/tool_inputs/stale-without-id.png" }]),
    ).toThrow("第 1 个素材尚未就绪");
  });

  it("parses only contiguous versioned manifests", () => {
    expect(
      parseGenerationInputManifest(
        JSON.stringify({
          version: 1,
          items: [
            { position: 0, source: "legacy_path", path: "/uploads/a.png" },
            { position: 1, source: "tool_media", mediaId: firstId },
          ],
        }),
      ),
    ).toEqual({
      version: 1,
      items: [
        { position: 0, source: "legacy_path", path: "/uploads/a.png" },
        { position: 1, source: "tool_media", mediaId: firstId },
      ],
    });

    expect(() =>
      parseGenerationInputManifest(
        JSON.stringify({
          version: 1,
          items: [{ position: 1, source: "legacy_path", path: "/uploads/a.png" }],
        }),
      ),
    ).toThrow(GenerationInputManifestError);
  });

  it("rejects source fields that are missing, extra, or reordered", () => {
    const manifest = parseGenerationInputManifest(
      JSON.stringify({
        version: 1,
        items: [
          { position: 0, source: "tool_media", mediaId: firstId },
          { position: 1, source: "legacy_path", path: "/uploads/a.png" },
          { position: 2, source: "tool_media", mediaId: secondId },
        ],
      }),
    )!;

    expect(() => assertGenerationInputManifestMatches(manifest, [], [])).toThrow(
      GenerationInputManifestError,
    );
    expect(() =>
      assertGenerationInputManifestMatches(manifest, [secondId, firstId], ["/uploads/a.png"]),
    ).toThrow(GenerationInputManifestError);
    expect(() =>
      assertGenerationInputManifestMatches(manifest, [firstId, secondId], ["/uploads/a.png", "/uploads/extra.png"]),
    ).toThrow(GenerationInputManifestError);
  });

  it("rejects interleaving when any source value is missing", () => {
    const manifest = buildGenerationInputSubmission([
      { mediaId: firstId, url: "/uploads/tool_inputs/a.png" },
      { url: "/uploads/product-library/b.png" },
    ]).manifest;

    expect(() => interleaveGenerationInputValues(manifest, ["tool-a"], [])).toThrow(
      "素材数量与顺序清单不一致",
    );
  });
});
