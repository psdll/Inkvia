import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

let uploadsRoot = "";

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.resetModules();
  if (uploadsRoot) await fs.rm(uploadsRoot, { recursive: true, force: true });
  uploadsRoot = "";
});

describe("material asset persistent downloads", () => {
  it("streams single and series files from UPLOADS_DIR", async () => {
    uploadsRoot = await fs.mkdtemp(path.join(os.tmpdir(), "material-downloads-"));
    await fs.mkdir(path.join(uploadsRoot, "materials"), { recursive: true });
    await fs.writeFile(path.join(uploadsRoot, "materials", "one.png"), Buffer.from("first-image"));
    await fs.writeFile(path.join(uploadsRoot, "materials", "two.jpg"), Buffer.from("second-image"));
    vi.stubEnv("UPLOADS_DIR", uploadsRoot);
    vi.resetModules();

    const { materialSeriesZipResponse, singleMaterialFileResponse } = await import(
      "@/lib/material-asset-download"
    );
    const first = {
      id: "one",
      originalUrl: "/uploads/materials/one.png",
      previewUrl: "/uploads/materials/one.png",
      thumbnailUrl: "/uploads/materials/one.png",
      mime: "image/png",
      size: null,
    };
    const second = {
      id: "two",
      originalUrl: "/uploads/materials/two.jpg",
      previewUrl: "/uploads/materials/two.jpg",
      thumbnailUrl: "/uploads/materials/two.jpg",
      mime: "image/jpeg",
      size: null,
    };

    const single = await singleMaterialFileResponse("按摩椅", first);
    expect(single.status).toBe(200);
    expect(Buffer.from(await single.arrayBuffer()).toString()).toBe("first-image");
    expect(single.headers.get("content-disposition")).toContain("attachment");

    const series = materialSeriesZipResponse("按摩椅系列", [first, second]);
    expect(series.status).toBe(200);
    expect(series.headers.get("content-type")).toBe("application/zip");
    expect(Buffer.from(await series.arrayBuffer()).subarray(0, 2).toString()).toBe("PK");
  });
});
