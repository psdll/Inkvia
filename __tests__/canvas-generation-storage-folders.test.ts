import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("canvas generation storage folders", () => {
  it("registers both canvas result folders in media serving and storage administration", () => {
    const uploadRoute = read("app/api/uploads/[...path]/route.ts");
    const storageScan = read("lib/admin-storage-scan.ts");
    const storageRoute = read("app/api/admin/storage/route.ts");

    for (const folder of ["canvas_image_results", "canvas_video_results"]) {
      expect(uploadRoute).toContain(folder);
      expect(storageScan).toContain(folder);
      expect(storageRoute).toContain(folder);
    }
  });
});
