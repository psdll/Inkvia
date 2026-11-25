import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getUserId: vi.fn(),
  createImageGenerationBatch: vi.fn(),
}));

vi.mock("@/lib/server-auth", () => ({ getUserId: mocks.getUserId }));
vi.mock("@/lib/generation/image-service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/generation/image-service")>();
  return {
    ...actual,
    createImageGenerationBatch: mocks.createImageGenerationBatch,
  };
});

import { POST } from "@/app/api/image-edit/route";

const firstId = "11111111-1111-4111-8111-111111111111";
const legacyPath = "/uploads/product-library/legacy.png";

describe("image ordered media submission", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUserId.mockResolvedValue(7);
    mocks.createImageGenerationBatch.mockResolvedValue({
      batchId: "batch-1",
      taskCount: 1,
      succeededCount: 1,
      failedCount: 0,
      tasks: [
        {
          batchIndex: 1,
          generationId: 91,
          taskId: "provider-task",
          status: "running",
        },
      ],
    });
  });

  it("passes a validated interleaved manifest to the image service", async () => {
    const form = new FormData();
    form.set("prompt", "edit");
    form.set("model", "nano-banana-pro");
    form.append("toolMediaId[]", firstId);
    form.set("imagePaths", JSON.stringify([legacyPath]));
    form.set(
      "inputManifest",
      JSON.stringify({
        version: 1,
        items: [
          { position: 0, source: "legacy_path", path: legacyPath },
          { position: 1, source: "tool_media", mediaId: firstId },
        ],
      }),
    );

    const response = await POST(
      new NextRequest("http://localhost/api/image-edit", {
        method: "POST",
        body: form,
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.createImageGenerationBatch).toHaveBeenCalledWith(
      expect.objectContaining({
        toolMediaIds: [firstId],
        imagePaths: [legacyPath],
        inputManifest: {
          version: 1,
          items: [
            { position: 0, source: "legacy_path", path: legacyPath },
            { position: 1, source: "tool_media", mediaId: firstId },
          ],
        },
      }),
    );
  });

  it("rejects old mixed fields because their UI order is unknowable", async () => {
    const form = new FormData();
    form.set("prompt", "edit");
    form.set("model", "nano-banana-pro");
    form.append("toolMediaId[]", firstId);
    form.set("imagePaths", JSON.stringify([legacyPath]));

    const response = await POST(
      new NextRequest("http://localhost/api/image-edit", {
        method: "POST",
        body: form,
      }),
    );

    expect(response.status).toBe(400);
    expect(mocks.createImageGenerationBatch).not.toHaveBeenCalled();
  });

  it("rejects a manifest that does not match the submitted fields", async () => {
    const form = new FormData();
    form.set("prompt", "edit");
    form.set("model", "nano-banana-pro");
    form.append("toolMediaId[]", firstId);
    form.set(
      "inputManifest",
      JSON.stringify({
        version: 1,
        items: [{ position: 0, source: "legacy_path", path: legacyPath }],
      }),
    );

    const response = await POST(
      new NextRequest("http://localhost/api/image-edit", {
        method: "POST",
        body: form,
      }),
    );

    expect(response.status).toBe(400);
    expect(mocks.createImageGenerationBatch).not.toHaveBeenCalled();
  });
});


it.each(["512x288", "288x512", "640x432"])("preserves %s GIF parameters from studio form submission", async gifSize => {
  mocks.getUserId.mockResolvedValue(7);
  const form = new FormData();
  for (const [key, value] of Object.entries({ prompt: "cat waves", model: "gpt-image-2.6-apimart", outputFormat: "gif", gifSize, frameCount: "9", frameDurationMs: "200" })) form.set(key, value);
  const response = await POST(new NextRequest("http://localhost/api/image-edit", { method: "POST", body: form }));
  expect(response.status).toBe(200);
  expect(mocks.createImageGenerationBatch).toHaveBeenCalledWith(expect.objectContaining({ outputFormat: "gif", gifSize, frameCount: 9, frameDurationMs: 200 }));
});
