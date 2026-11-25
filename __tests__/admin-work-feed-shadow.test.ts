import { describe, expect, it } from "vitest";
import { compareProjectionPages } from "../scripts/compare-admin-work-feed.mjs";

describe("admin work feed shadow comparison", () => {
  it("compares ordered id, status, type and thumbnail fields", () => {
    const base = [{ id: 2, status: "success", type: "image_edit", thumbUrl: "/thumb-2.webp" }];

    expect(compareProjectionPages(base, base)).toEqual([]);
    expect(compareProjectionPages(base, [{ ...base[0], status: "failed" }])).toEqual([
      expect.objectContaining({ index: 0, field: "status", legacy: "success", feed: "failed" }),
    ]);
  });
});
