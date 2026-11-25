import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isPublicExport } from "./support/public-export";

describe("generation size backfill rollout", () => {
  it.skipIf(isPublicExport)("does not mutate historical sizes during automatic updates", () => {
    const updater = fs.readFileSync(
      path.join(process.cwd(), "config", "deploy", "server", "inkvia-updater"),
      "utf8",
    );
    expect(updater).not.toContain("backfill-generation-sizes.mjs");
    expect(updater).not.toContain("admin-read-model-backfill.mjs --apply");
  });

  it("uses keyset pagination so updated rows cannot make later candidates get skipped", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "scripts", "backfill-generation-sizes.mjs"),
      "utf8",
    );

    expect(source).toContain("id: { gt: cursor }");
    expect(source).toContain("sizeBytes: { lte: 0 }");
    expect(source).not.toContain("skip: cursor");
  });
});
