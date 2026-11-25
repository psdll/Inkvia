import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("thumbnail retention", () => {
  it("does not automatically delete valid thumbnails by 30-day mtime", () => {
    const bootstrap = fs.readFileSync(path.join(process.cwd(), "lib/server-bootstrap.ts"), "utf8");
    expect(bootstrap).not.toContain("runThumbsCleanup");
    expect(bootstrap).not.toContain("THUMBS_RETENTION_DAYS");
  });

  it("keeps the explicit administrator cleanup action", () => {
    const route = fs.readFileSync(path.join(process.cwd(), "app/api/admin/storage/route.ts"), "utf8");
    expect(route).toContain('action === "cleanup_thumbs"');
  });
});
