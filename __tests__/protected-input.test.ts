import { afterEach, describe, expect, it, vi } from "vitest";
import * as protectedInput from "@/lib/protected-input";

type TrackedImport = (input: {
  sourceUrl: string;
  userId: string;
  inFlight: Set<string>;
  importer?: (sourceUrl: string, userId: string) => Promise<string>;
}) => Promise<string | null>;

type TimedImport = (
  sourceUrl: string,
  userId: string,
  options: { fetcher: typeof fetch; timeoutMs: number },
) => Promise<string>;

describe("protected input imports", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("releases a completed source so the same material can be imported again", async () => {
    const runTrackedImport = (
      protectedInput as typeof protectedInput & {
        importInputToImportsTracked?: TrackedImport;
      }
    ).importInputToImportsTracked;

    expect(runTrackedImport).toBeTypeOf("function");
    if (!runTrackedImport) return;

    const inFlight = new Set<string>();
    const importer = vi
      .fn<(sourceUrl: string, userId: string) => Promise<string>>()
      .mockResolvedValueOnce("/uploads/imports/first.jpg")
      .mockResolvedValueOnce("/uploads/imports/second.jpg");
    const input = {
      sourceUrl: "/uploads/products/shared/image/product.jpg",
      userId: "27",
      inFlight,
      importer,
    };

    await expect(runTrackedImport(input)).resolves.toBe("/uploads/imports/first.jpg");
    expect(inFlight).not.toContain(input.sourceUrl);
    await expect(runTrackedImport(input)).resolves.toBe("/uploads/imports/second.jpg");
    expect(importer).toHaveBeenCalledTimes(2);
  });

  it("releases a failed source instead of leaving it permanently blocked", async () => {
    const runTrackedImport = (
      protectedInput as typeof protectedInput & {
        importInputToImportsTracked?: TrackedImport;
      }
    ).importInputToImportsTracked;

    expect(runTrackedImport).toBeTypeOf("function");
    if (!runTrackedImport) return;

    const sourceUrl = "/uploads/products/shared/image/product.jpg";
    const inFlight = new Set<string>();

    await expect(runTrackedImport({
      sourceUrl,
      userId: "27",
      inFlight,
      importer: async () => {
        throw new Error("copy failed");
      },
    })).rejects.toThrow("copy failed");
    expect(inFlight).not.toContain(sourceUrl);
  });

  it("turns a stalled request into an explicit timeout error", async () => {
    vi.useFakeTimers();
    const importWithTimeout = protectedInput.importInputToImports as TimedImport;
    const fetcher = vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("Aborted", "AbortError"));
        }, { once: true });
      })) as unknown as typeof fetch;

    const result = Promise.race([
      importWithTimeout("/uploads/products/shared/image/product.jpg", "27", {
        fetcher,
        timeoutMs: 100,
      }).then(
        (value) => ({ kind: "resolved", value }),
        (error) => ({ kind: "rejected", message: String(error?.message || error) }),
      ),
      new Promise<{ kind: "still-pending" }>((resolve) => {
        setTimeout(() => resolve({ kind: "still-pending" }), 101);
      }),
    ]);

    await vi.advanceTimersByTimeAsync(101);
    await expect(result).resolves.toEqual({
      kind: "rejected",
      message: "素材处理超时，请重新添加或重试",
    });
  });
});
