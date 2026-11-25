import { it, expect } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { probeCanvasMediaPooled } from "@/lib/canvas/media-probe-pool";

it("probes concurrent images, rejects invalid input and recovers for subsequent uploads", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "canvas-probe-pool-"));
  const file = path.join(directory, "image.png");
  try {
    await sharp({ create: { width: 36, height: 72, channels: 3, background: "red" } }).png().toFile(file);
    const results = await Promise.all(Array.from({ length: 16 }, () => probeCanvasMediaPooled(file, "image")));
    for (const result of results) expect(result).toMatchObject({kind: "image", width: 36, height: 72, detectedMime: "image/png"});
    await expect(probeCanvasMediaPooled(path.join(directory, "missing.png"), "image")).rejects.toThrow();
    expect(await probeCanvasMediaPooled(file, "image")).toMatchObject({width: 36, height: 72});
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
}, 15000);
