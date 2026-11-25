import { describe, expect, it } from "vitest";
import { createCanvasMutationAdmission } from "@/lib/canvas/mutation-admission";

describe("canvas mutation admission", () => {
  it("admits only the configured number of concurrent writes", () => {
    const admission = createCanvasMutationAdmission({ maxConcurrent: 2 });
    const first = admission.tryAcquire();
    const second = admission.tryAcquire();

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(admission.tryAcquire()).toBeNull();
    expect(admission.active()).toBe(2);

    first?.release();
    expect(admission.tryAcquire()).not.toBeNull();
  });

  it("makes release idempotent", () => {
    const admission = createCanvasMutationAdmission({ maxConcurrent: 1 });
    const permit = admission.tryAcquire();
    permit?.release();
    permit?.release();

    expect(admission.active()).toBe(0);
  });
});
