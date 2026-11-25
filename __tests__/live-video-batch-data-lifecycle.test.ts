import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function read(path: string) {
  return readFileSync(path, "utf8");
}

describe("live video batch data lifecycle", () => {
  it("persists batches, items, prompt jobs, and immutable video attempts", () => {
    const schema = read("prisma/schema.prisma");
    const migration = read(
      "prisma/migrations/20260811150000_add_live_video_batches/migration.sql",
    );

    for (const model of [
      "LiveVideoBatch",
      "LiveVideoBatchItem",
      "LiveVideoPromptJob",
      "LiveVideoBatchOutput",
    ]) {
      expect(schema).toContain(`model ${model} {`);
      expect(migration).toContain(`CREATE TABLE \"${model}\"`);
    }
    expect(schema).toContain("requestSnapshot Json");
    expect(schema).toContain("@@unique([itemId, attempt])");
    expect(schema).toContain("@@index([status, availableAt, leaseUntil, createdAt])");
    expect(schema).toContain("@@index([status, nextPollAt, leaseUntil, createdAt])");
  });

  it("deletes owned live batches before media and user rows", () => {
    const deletion = read("lib/admin-user-delete.ts");
    const liveIndex = deletion.indexOf("client.liveVideoBatch.deleteMany");
    expect(liveIndex).toBeGreaterThan(-1);
    expect(liveIndex).toBeLessThan(deletion.indexOf("client.mediaAsset.deleteMany"));
    expect(liveIndex).toBeLessThan(deletion.indexOf("client.user.deleteMany"));
  });

  it("exports and restores all four tables in dependency order", () => {
    const exporter = read("lib/admin/user-export-builder.ts");
    const importer = read("lib/admin/user-import-runner.ts");

    for (const file of [
      "live_video_batches.json",
      "live_video_batch_items.json",
      "live_video_prompt_jobs.json",
      "live_video_batch_outputs.json",
    ]) {
      expect(exporter).toContain(`data/${file}`);
      expect(importer).toContain(`data/${file}`);
    }
    expect(importer.indexOf('"liveVideoBatch",')).toBeLessThan(
      importer.indexOf('"liveVideoBatchItem",'),
    );
    expect(importer.indexOf('"liveVideoBatchItem",')).toBeLessThan(
      importer.indexOf('"liveVideoPromptJob",'),
    );
    expect(importer.indexOf('"liveVideoPromptJob",')).toBeLessThan(
      importer.indexOf('"liveVideoBatchOutput",'),
    );
  });

  it("detaches live video outputs before purging their generations", () => {
    const purge = read("app/api/admin/user/purge-data/route.ts");
    expect(purge.indexOf("deleteGenerationRowsAndBatchCards")).toBeGreaterThan(-1);
  });
});
