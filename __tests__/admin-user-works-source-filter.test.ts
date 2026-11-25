import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildWorksListFilter } from "@/lib/admin-user-works";

describe("admin user works source filter", () => {
  it("filters generated works by the same creation sources as the assets page", () => {
    expect(buildWorksListFilter("generated", "all", "creation")).toEqual({
      type: { not: "import" },
      source: { in: ["tool", "canvas", "batch", "agent"] },
    });
    expect(buildWorksListFilter("generated", "all", "tool")).toEqual({
      type: { not: "import" },
      AND: [
        { source: "tool" },
        { liveVideoBatchOutput: { is: null } },
      ],
    });
    expect(buildWorksListFilter("generated", "all", "canvas")).toEqual({
      type: { not: "import" },
      source: "canvas",
    });
    expect(buildWorksListFilter("generated", "all", "agent")).toEqual({
      type: { not: "import" },
      source: "agent",
    });
    expect(buildWorksListFilter("generated", "all", "batch")).toEqual({
      type: { not: "import" },
      OR: [
        { source: "batch" },
        { liveVideoBatchOutput: { isNot: null } },
      ],
    });
    expect(buildWorksListFilter("generated", "all", "batch:multi_prompt")).toEqual({
      type: { not: "import" },
      batchOutput: { is: { batch: { mode: "multi_prompt" } } },
    });
  });

  it("keeps the unreferenced import cleanup independent from creation source", () => {
    expect(buildWorksListFilter("all", "import", "canvas")).toEqual({ type: "import" });
  });

  it("renders the shared themed creation filter in the admin works toolbar", () => {
    const panelSource = readFileSync(resolve(process.cwd(), "components/admin/UserWorksPanel.tsx"), "utf8");

    expect(panelSource).toContain("<AssetSourceSelect");
    expect(panelSource).not.toContain("const SOURCE_FILTER_OPTIONS");
  });
});
