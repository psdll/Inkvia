import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createEmptyCanvasDocumentV2, isCanvasDocumentV2 } from "@/lib/canvas/document";

describe("smart-only canvas contract", () => {
  it("accepts only versioned smart documents", () => {
    expect(isCanvasDocumentV2(createEmptyCanvasDocumentV2())).toBe(true);
    expect(isCanvasDocumentV2({ mode: "smart", nodes: [], connections: [] })).toBe(false);
    expect(isCanvasDocumentV2({ mode: "node", nodes: [], edges: [] })).toBe(false);
  });

  it("keeps legacy cleanup out of automatic Prisma migrations", () => {
    const migration = readFileSync(
      resolve(process.cwd(), "prisma/migrations/20260713090000_remove_legacy_canvas_data/migration.sql"),
      "utf8",
    );
    expect(migration).not.toMatch(/DELETE\s+FROM\s+"Canvas"/i);
    expect(migration).toContain("archive-and-reset script");
  });
});
