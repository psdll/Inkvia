import { verifyAvailableVideoModel } from './helpers/canvas-ui-contract-harness';

import { readChineseUiSource as readFileSync } from "./helpers/chinese-ui-source";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(path, "utf8").replace(/\r\n/g, "\n");
}

describe("model and material visibility regressions", () => {
  it("uses the image-model label returned by the admin-backed API", () => {
    const imageTool = source("app/image/image-tool.tsx");

    expect(imageTool).toContain("const visibleLabels = new Map<string, string>(");
    expect(imageTool).toContain("label: visibleLabels.get(option.value) || option.label");
  });

  it("keeps the enabled video-model selector available when a canvas node has no valid selection", async () => {

    await verifyAvailableVideoModel();
  });

  it("shows an explicit terminal state after the material library loads its final page", () => {
    const materials = source("app/materials/page.tsx");

    expect(materials).toContain("!pagination.hasMore && displayItems.length > 0");
    expect(materials).toContain("已加载全部 {pagination.total} 个素材");
  });
});
