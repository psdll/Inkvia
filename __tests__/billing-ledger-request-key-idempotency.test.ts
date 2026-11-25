import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ default: {}, prisma: {} }));

import { upsertUsageLedgerForGeneration } from "@/lib/billing-ledger";

describe("usage ledger request-key reconciliation", () => {
  it("reuses the canonical ledger when a legacy duplicate generation hits requestKey P2002", async () => {
    const canonical = {
      id: 7,
      generationId: 40,
      requestKey: "44444444-4444-4444-8444-444444444444",
    };
    const db = {
      usageLedger: {
        upsert: vi.fn(async () => {
          throw {
            code: "P2002",
            meta: {
              modelName: "UsageLedger",
              target: ["requestKey"],
            },
          };
        }),
        findUnique: vi.fn(async () => canonical),
      },
    };

    await expect(upsertUsageLedgerForGeneration({
      id: 41,
      userId: "7",
      authUserId: 7,
      type: "image_edit",
      source: "batch",
      prompt: "test",
      templateData: "{}",
      model: "nano-banana-pro",
      status: "failed",
      requestKey: canonical.requestKey,
      externalProvider: "kie",
      externalTaskId: "provider-task-41",
      errorMsg: "duplicate",
      createdAt: new Date("2026-07-30T08:55:50.000Z"),
      finishedAt: new Date("2026-07-30T09:10:00.000Z"),
    }, db)).resolves.toBe(canonical);

    expect(db.usageLedger.findUnique).toHaveBeenCalledWith({
      where: { requestKey: canonical.requestKey },
    });
  });
});
