import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("public upload path resolution", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("routes every uploads path through the configured persistent root", async () => {
    const uploadsRoot = path.resolve("tmp/persistent-uploads");
    vi.stubEnv("UPLOADS_DIR", uploadsRoot);
    vi.resetModules();
    const { resolvePublicPath } = await import("@/lib/public-path");

    expect(resolvePublicPath("uploads", "imports", "file.png")).toBe(
      path.join(uploadsRoot, "imports", "file.png"),
    );
    expect(resolvePublicPath("uploads/batch_imports/file.png")).toBe(
      path.join(uploadsRoot, "batch_imports", "file.png"),
    );
  });
});
