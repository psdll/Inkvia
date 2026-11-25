import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ default: {} }));
vi.mock("@/lib/providers/transport", () => ({}));
import { readOpenRouterReferenceDimensions } from "@/lib/openrouter-image";

describe("OpenRouter first reference metadata", () => {
  let directory: string;
  beforeAll(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), "openrouter-reference-"));
    vi.stubEnv("UPLOADS_DIR", directory);
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    await fs.rm(directory, { recursive: true, force: true });
  });
  it("reads original pixels and respects EXIF portrait orientation", async () => {
    const input = sharp({ create: { width: 120, height: 80, channels: 3, background: "white" } });
    await input.clone().png().toFile(path.join(directory, "plain.png"));
    await input.clone().withMetadata({ orientation: 6 }).jpeg().toFile(path.join(directory, "rotated.jpg"));
    expect(await readOpenRouterReferenceDimensions("/uploads/plain.png")).toEqual({ width: 120, height: 80 });
    expect(await readOpenRouterReferenceDimensions("/uploads/rotated.jpg")).toEqual({ width: 80, height: 120 });
  });
  it("fails for unreadable references instead of submitting an uncontrolled size", async () => {
    await expect(readOpenRouterReferenceDimensions("/uploads/missing.png")).rejects.toThrow();
    await expect(readOpenRouterReferenceDimensions("/uploads/../outside.png")).rejects.toThrow("上传目录");
  });
});
