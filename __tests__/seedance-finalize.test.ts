import { describe, expect, it } from "vitest";
import { FINALIZE_MAX_AGE_MS } from "@/lib/generation/finalize";

describe("Seedance finalize timeout policy", () => {
  it("allows at least 20 minutes before a still-running provider task can time out", () => {
    expect(FINALIZE_MAX_AGE_MS).toBeGreaterThanOrEqual(20 * 60 * 1000);
  });
});
