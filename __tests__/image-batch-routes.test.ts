import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => {
  expect(existsSync(path), `${path} must exist`).toBe(true);
  return readFileSync(path, "utf8");
};

describe("image batch API routes", () => {
  it("provides authenticated batch, item, prompt and status endpoints", () => {
    const routes = [
      "app/api/image-batches/route.ts",
      "app/api/image-batches/[batchId]/route.ts",
      "app/api/image-batches/[batchId]/items/route.ts",
      "app/api/image-batches/[batchId]/groups/route.ts",
      "app/api/image-batches/[batchId]/prompts/preview/route.ts",
      "app/api/image-batches/[batchId]/prompts/apply/route.ts",
      "app/api/image-batches/[batchId]/media/route.ts",
      "app/api/image-batches/[batchId]/product-library/route.ts",
      "app/api/image-batches/[batchId]/media/[relationId]/route.ts",
      "app/api/image-batches/[batchId]/submit/route.ts",
      "app/api/image-batches/[batchId]/retry/route.ts",
      "app/api/image-batches/[batchId]/cancel/route.ts",
      "app/api/image-batches/[batchId]/status/route.ts",
    ];
    for (const route of routes) {
      expect(read(route)).toContain("getUserId");
    }
  });

  it("registers an independent batch worker without modifying the canvas worker", () => {
    const pkg = JSON.parse(read("package.json"));
    expect(pkg.scripts["worker:image-batch"]).toBe(
      "tsx --conditions=react-server scripts/image-batch-worker.ts",
    );
    const worker = read("scripts/image-batch-worker.ts");
    expect(worker).toContain("runImageBatchWorkerIteration");
    expect(worker).not.toContain("canvas-worker");
  });

  it("keeps the batch media directory and relay prefix server selected", () => {
    const upload = read("app/api/image-batches/[batchId]/media/route.ts");
    expect(upload).toContain('storageProfile: "batch"');
    expect(upload).not.toContain('form.get("folder")');
    expect(upload).not.toContain('form.get("relayFolder")');
  });

  it("uses structured status codes for ownership, validation and version conflicts", () => {
    const batchRoute = read("app/api/image-batches/[batchId]/route.ts");
    expect(batchRoute).toContain("BATCH_VERSION_CONFLICT");
    expect(batchRoute).toContain("BATCH_NOT_FOUND");
    expect(batchRoute).toContain("groupChanges");
  });

  it("imports product-library items by stable ID without accepting a client URL", () => {
    const route = read("app/api/image-batches/[batchId]/product-library/route.ts");
    expect(route).toContain("importImageBatchProductLibraryMedia");
    expect(route).toContain("productLibraryItemId");
    expect(route).toContain("requestKey");
    expect(route).not.toContain("fileUrl");
    expect(route).not.toContain("fetch(");
  });

  it("loads one reusable template directly for the requested mode", () => {
    const route = read("app/api/image-batches/route.ts");
    expect(route).toContain("getOrCreateImageBatchTemplate");
    expect(route).toContain('searchParams.get("templateMode")');
  });
});
