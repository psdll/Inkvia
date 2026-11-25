import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/prisma", () => ({ default: {} }));
import {
  activeAt,
  billingDate,
  billingMonth,
  convertToCny,
  resolveExchangeRate,
  tokenCharges,
  validatePrice,
} from "@/lib/billing/money";
import { ledgerCny, monthlyReport } from "@/lib/billing/monthly";
import { upsertUsageLedgerForGeneration } from "@/lib/billing-ledger";
import { beginLlmCost, finishLlmCost } from "@/lib/billing/llm";

describe("versioned model costs", () => {
  it("uses Shanghai half-open calendar months, including leap days", () => {
    const r = billingMonth("2028-02");
    expect(r.start.toISOString()).toBe("2028-01-31T16:00:00.000Z");
    expect(r.end.toISOString()).toBe("2028-02-29T16:00:00.000Z");
    expect(r.keys).toHaveLength(29);
    expect(() => billingDate("2026-02-30")).toThrow();
  });
  it("never accepts an empty price as free", () => {
    for (const v of ["", null, undefined, -1, "NaN", "1e3"])
      expect(() => validatePrice(v)).toThrow();
    expect(validatePrice("0")).toBe("0");
  });
  it("uses supplier-specific historical rates, never a later rate or another supplier", () => {
    const rates = [
      {
        id: "old",
        provider: "a",
        currency: "USD",
        rate: "7.2",
        effectiveFrom: "2026-01-01T00:00:00Z",
        notes: "",
      },
      {
        id: "new",
        provider: "a",
        currency: "USD",
        rate: "7.5",
        effectiveFrom: "2026-10-01T00:00:00Z",
        notes: "",
      },
    ];
    expect(
      resolveExchangeRate(rates, "a", "USD", new Date("2026-09-20"))?.id,
    ).toBe("old");
    expect(
      resolveExchangeRate(rates, "b", "USD", new Date("2026-09-20")),
    ).toBeNull();
    expect(
      convertToCny(
        "3.6",
        resolveExchangeRate(rates, "a", "USD", new Date("2026-09-20")),
      ),
    ).toBe("25.92000000");
    expect(convertToCny("3.6", null)).toBeNull();
  });
  it("charges cached tokens once and keeps decimal precision", () => {
    const result = tokenCharges(
      {
        inputTokens: 1000000,
        outputTokens: 200000,
        cachedInputTokens: 100000,
        cacheCreationInputTokens: 100000,
      },
      {
        input_million_token: "2",
        output_million_token: "8",
        cached_million_token: "0.2",
        cache_creation_million_token: "3",
      },
    );
    expect(result?.amount).toBe("3.52000000");
    expect(tokenCharges({ inputTokens: null, outputTokens: 0 }, {})).toBeNull();
    expect(
      tokenCharges(
        { inputTokens: 10, outputTokens: 0, cachedInputTokens: 11 },
        { input_million_token: 1 },
      ),
    ).toBeNull();
    expect(
      tokenCharges(
        { inputTokens: 1, outputTokens: 0 },
        { input_million_token: "0.1" },
      )?.amount,
    ).toBe("0.00000010");
  });
  it("closes the old price at the exact new-price boundary", () => {
    const r = {
      isActive: true,
      effectiveFrom: "2026-01-01T00:00:00Z",
      effectiveTo: "2026-09-30T16:00:00Z",
    };
    expect(activeAt(r, new Date("2026-09-30T15:59:59Z"))).toBe(true);
    expect(activeAt(r, new Date("2026-09-30T16:00:00Z"))).toBe(false);
  });
  it("does not reprice settled generations on duplicate callbacks", async () => {
    const prior = {
      costStatus: "priced",
      amount: "1.23",
      pricingSnapshot: { conversion: { rate: "7.2" } },
    };
    const db = {
      usageLedger: {
        findUnique: vi.fn().mockResolvedValue(prior),
        upsert: vi.fn(),
      },
      billingPriceRule: { findMany: vi.fn() },
    };
    expect(await upsertUsageLedgerForGeneration({ id: 9 } as any, db)).toBe(
      prior,
    );
    expect(db.billingPriceRule.findMany).not.toHaveBeenCalled();
    expect(db.usageLedger.upsert).not.toHaveBeenCalled();
  });
  it("does not present unpriced/foreign historical rows as zero CNY", () => {
    expect(
      ledgerCny({ costStatus: "unpriced", currency: "CNY", amount: 0 }),
    ).toBeNull();
    expect(
      ledgerCny({ costStatus: "priced", currency: "USD", amount: 2 }),
    ).toBeNull();
    expect(
      ledgerCny({ costStatus: "priced", currency: "CNY", amount: "0.123456" }),
    ).toBe("0.123456");
  });
  it("aggregates more than 10,000 rows and never adds native currencies", async () => {
    const base = {
      day: "2026-09-01",
      provider: "p",
      model: "m",
      module: "image",
      source: "tool",
      unitType: "image",
      unitPrice: "1",
      rate: "1",
      rateId: null,
      priceFrom: null,
      costStatus: "priced",
      status: "success",
      billableCount: 10001,
      count: 10001,
      pending: 0,
      unitCount: "10001",
    };
    const db = {
      $queryRaw: vi.fn().mockResolvedValue([
        {
          ...base,
          currency: "CNY",
          originalAmount: "10001",
          amountCny: "10001",
        },
        {
          ...base,
          currency: "USD",
          billableCount: 1,
          count: 1,
          unitCount: "1",
          originalAmount: "2",
          amountCny: "14.4",
          rate: "7.2",
        },
      ]),
    };
    const report = await monthlyReport({ month: "2026-09" }, db);
    expect(report.summary.ledgerCount).toBe(10002);
    expect(report.summary.totalAmount).toBe("10015.40000000");
    expect(report.summary.originalTotals).toEqual({
      CNY: "10001.00000000",
      USD: "2.00000000",
    });
    expect(db.$queryRaw.mock.calls[0][0].sql).not.toMatch(/LIMIT/i);
  });
  it("locks token rates before dispatch and settles with the same version", async () => {
    const units = [
      "input_million_token",
      "output_million_token",
      "cached_million_token",
      "cache_creation_million_token",
    ];
    const create = vi.fn().mockResolvedValue({ id: 8 }),
      updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const db = {
      appSetting: {
        findUnique: vi
          .fn()
          .mockResolvedValue({
            value: JSON.stringify({
              mode: "strict",
              revision: 1,
              rates: [
                {
                  id: "fx",
                  provider: "p",
                  currency: "USD",
                  rate: "7.2",
                  effectiveFrom: "2020-01-01",
                  notes: "",
                },
              ],
            }),
          }),
      },
      billingPriceRule: {
        findMany: vi
          .fn()
          .mockResolvedValue(
            units.map((u, i) => ({
              id: i,
              unitType: u,
              unitPrice: i === 1 ? 8 : 2,
              currency: "USD",
              isActive: true,
              effectiveFrom: new Date("2020-01-01"),
            })),
          ),
      },
      usageLedger: { create, updateMany },
    };
    const call = await beginLlmCost(
      { provider: "p", model: "m", source: "test" },
      db,
    );
    await finishLlmCost(
      call,
      { inputTokens: 1000000, outputTokens: 200000 },
      true,
      db,
    );
    expect(updateMany.mock.calls[0][0]).toMatchObject({
      data: { usageSnapshot: { inputTokens: 1000000, outputTokens: 200000 } },
    });
    expect(updateMany.mock.calls[1][0]).toMatchObject({
      where: { id: 8, costStatus: "pending" },
      data: {
        costStatus: "priced",
        pricingSnapshot: {
          conversion: { amountCny: "25.92000000", rate: "7.2" },
        },
      },
    });
    expect(db.appSetting.findUnique).toHaveBeenCalledTimes(1);
  });
});
