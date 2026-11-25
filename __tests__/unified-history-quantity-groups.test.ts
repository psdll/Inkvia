import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(process.cwd(), "components/history/unified-history-panel.tsx"), "utf8");

describe("unified history quantity groups", () => {
  it("uses one display-group key for the main canvas and history thumbnails", () => {
    expect(source).toContain("getHistoryDisplayGroupKey");
    expect(source).not.toContain("activeItem.externalTaskId || activeItem.id");
    expect(source).not.toContain("it.externalTaskId || it.id");
  });

  it("keeps the requested batch size on optimistic pending items", () => {
    expect(source).toContain("batchSize: count");
  });

  it("renders pending and failed slots inside a quantity-series container", () => {
    expect(source).toContain("groupItemGenerating && !groupDisplayUrl");
    expect(source).toContain("groupItemFailed && !groupDisplayUrl");
    expect(source).toContain("hasGroupDisplay");
  });
});
