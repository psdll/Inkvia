import { describe, expect, it, vi } from "vitest";

import {
  assertMiniMaxH3ConcurrencyAvailable,
  MiniMaxH3ConcurrencyError,
} from "@/lib/minimax-h3-concurrency";
import { MINIMAX_H3_PAID_CONCURRENCY } from "@/lib/minimax-models";

describe("MiniMax-H3 paid concurrency guard", () => {
  it("serializes the reservation and allows the fifteenth running task", async () => {
    const tx = {
      $executeRawUnsafe: vi.fn().mockResolvedValue(1),
      generation: { count: vi.fn().mockResolvedValue(MINIMAX_H3_PAID_CONCURRENCY - 1) },
    };

    await expect(assertMiniMaxH3ConcurrencyAvailable(tx as never)).resolves.toBeUndefined();

    expect(tx.$executeRawUnsafe).toHaveBeenCalledWith(
      "SELECT pg_advisory_xact_lock($1::integer, $2::integer)",
      1296649550,
      1211302144,
    );
    expect(tx.generation.count).toHaveBeenCalledWith({
      where: {
        externalProvider: "minimax",
        model: "minimax-h3",
        status: { in: ["running", "queued", "pending", "processing", "submitted"] },
      },
    });
  });

  it("rejects the sixteenth running task with a retryable response", async () => {
    const tx = {
      $executeRawUnsafe: vi.fn().mockResolvedValue(1),
      generation: { count: vi.fn().mockResolvedValue(MINIMAX_H3_PAID_CONCURRENCY) },
    };

    await expect(assertMiniMaxH3ConcurrencyAvailable(tx as never)).rejects.toMatchObject({
      name: "MiniMaxH3ConcurrencyError",
      status: 429,
    });
    await expect(assertMiniMaxH3ConcurrencyAvailable(tx as never)).rejects.toBeInstanceOf(
      MiniMaxH3ConcurrencyError,
    );
  });
});
