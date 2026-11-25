import { describe, expect, it } from "vitest";

import { groupAdminStorageNodes } from "@/lib/admin-storage-groups";

describe("admin storage directory groups", () => {
  it("groups nodes in fixed order and calculates totals", () => {
    const groups = groupAdminStorageNodes([
      { name: "batch_imports", bytes: 20 },
      { name: "image_results", bytes: 100 },
      { name: "canvas_imports", bytes: 5 },
      { name: "imports", bytes: 40 },
    ]);

    expect(groups.map((group) => group.key)).toEqual([
      "creation",
      "batch",
      "canvas",
    ]);
    expect(groups[0]).toMatchObject({
      label: "创作",
      count: 2,
      totalBytes: 140,
    });
  });

  it("sorts each group by size and preserves unknown folders", () => {
    const nodes = [
      { name: "future_plugin", bytes: 1 },
      { name: "imports", bytes: 10 },
      { name: "video_results", bytes: 20 },
    ];

    const groups = groupAdminStorageNodes(nodes);

    expect(
      groups
        .find((group) => group.key === "creation")
        ?.nodes.map((node) => node.name),
    ).toEqual(["video_results", "imports"]);
    expect(
      groups
        .find((group) => group.key === "other")
        ?.nodes.map((node) => node.name),
    ).toEqual(["future_plugin"]);
    expect(groups.flatMap((group) => group.nodes)).toHaveLength(nodes.length);
  });

  it("omits empty groups", () => {
    expect(groupAdminStorageNodes([])).toEqual([]);
  });

  it("assigns canvas library and private Agent memory to their workspaces", () => {
    const groups = groupAdminStorageNodes([
      { name: "canvas-library", bytes: 12 },
      { name: "canvas_voice_previews", bytes: 8 },
      { name: ".agent-memory", bytes: 4 },
    ]);

    expect(groups.map((group) => group.key)).toEqual(["canvas", "agent"]);
    expect(groups[0].nodes.map((node) => node.name)).toEqual([
      "canvas-library",
      "canvas_voice_previews",
    ]);
    expect(groups[1].nodes[0].name).toBe(".agent-memory");
  });
});
