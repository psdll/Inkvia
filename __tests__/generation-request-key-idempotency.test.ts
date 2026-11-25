import { describe, expect, it, vi } from "vitest";

describe("generation request-key idempotency", () => {
  it("returns the winning generation when a concurrent create hits requestKey P2002", async () => {
    const module = await import("@/lib/generation/request-key-idempotency").catch(() => null);
    expect(module).not.toBeNull();

    const existing = {
      id: 41,
      status: "running",
      externalTaskId: "provider-task-41",
      localPath: null,
    };
    const findExisting = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(existing);
    const execute = vi.fn(async () => {
      throw {
        code: "P2002",
        meta: {
          modelName: "Generation",
          target: ["requestKey"],
        },
      };
    });

    await expect(module!.runGenerationRequestIdempotently({
      requestKey: "44444444-4444-4444-8444-444444444444",
      execute,
      findExisting,
      mapExisting: (row: typeof existing) => ({ generationId: row.id }),
    })).resolves.toEqual({ generationId: 41 });
    expect(findExisting).toHaveBeenCalledTimes(2);
    expect(execute).toHaveBeenCalledOnce();
  });

  it("does not hide unrelated unique-constraint failures", async () => {
    const module = await import("@/lib/generation/request-key-idempotency").catch(() => null);
    expect(module).not.toBeNull();

    const error = {
      code: "P2002",
      meta: {
        modelName: "GenerationInputMedia",
        target: ["generationId", "mediaId"],
      },
    };

    await expect(module!.runGenerationRequestIdempotently({
      requestKey: "55555555-5555-4555-8555-555555555555",
      execute: async () => {
        throw error;
      },
      findExisting: async () => null,
      mapExisting: () => null,
    })).rejects.toBe(error);
  });
});
