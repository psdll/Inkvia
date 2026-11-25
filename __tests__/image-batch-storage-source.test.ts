import { describe, expect, it } from "vitest";

import {
  CREATION_ASSET_SOURCES,
  TOOL_CANVAS_ASSET_SOURCES,
  buildAssetSourceWhere,
  getAssetSourceLabel,
} from "@/lib/assets/source-filter";
import { generationOutputFolder } from "@/lib/generation/output-folder";
import { isToolMediaLocalPath } from "@/lib/tool-media/lifecycle";

describe("image batch storage and source contracts", () => {
  it("uses a dedicated result directory for every image batch completion path", () => {
    expect(generationOutputFolder("image_edit", "batch")).toBe("batch-image_results");
    expect(generationOutputFolder("image_edit", "tool")).toBe("image_results");
    expect(generationOutputFolder("image_edit", "canvas")).toBe("canvas_image_results");
  });

  it("includes Agent generations in the creation aggregate without changing the legacy aggregate", () => {
    expect(CREATION_ASSET_SOURCES).toEqual(["tool", "canvas", "batch", "agent"]);
    expect(TOOL_CANVAS_ASSET_SOURCES).toEqual(["tool", "canvas"]);
    expect(buildAssetSourceWhere("creation")).toEqual({
      source: { in: ["tool", "canvas", "batch", "agent"] },
    });
    expect(buildAssetSourceWhere("tool_canvas")).toEqual({
      AND: [
        { source: { in: ["tool", "canvas"] } },
        { liveVideoBatchOutput: { is: null } },
      ],
    });
  });

  it("labels batch generations independently from their storage path", () => {
    expect(getAssetSourceLabel("batch")).toBe("批量");
  });

  it("allows the shared tool cleanup service to manage batch imports only", () => {
    expect(isToolMediaLocalPath("/uploads/batch_imports/2026-07-28/input.png")).toBe(true);
    expect(isToolMediaLocalPath("/uploads/batch-image_results/2026-07-28/output.png")).toBe(false);
  });
});
