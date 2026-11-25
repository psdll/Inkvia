import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("admin works thumbnail prewarm", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "components/admin/UserWorksPanel.tsx"), "utf8");

  it("uses the bounded shared preview queue without making another blob copy on image load", () => {
    expect(source).toContain('from "@/lib/client/material-preview-queue"');
    expect(source).not.toContain("warmResilientImageCandidatesBatch");
    expect(source).toContain("warmOnLoad={false}");
  });

  it("virtualizes the complete date-grouped feed without replacing the existing scroll container", () => {
    expect(source).toContain('import { Virtuoso } from "react-virtuoso"');
    expect(source).toContain("customScrollParent={gridScrollParent}");
    expect(source).toContain("computeItemKey={getVirtualRowKey}");
    expect(source).not.toContain("disableVirtualization");
  });

  it("routes local original thumb urls through the thumbnail candidate builder", () => {
    expect(source).toContain("buildMediaPreviewCandidates(thumb, { width })");
  });
});
