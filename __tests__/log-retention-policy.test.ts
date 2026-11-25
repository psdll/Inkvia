import { describe, expect, it } from "vitest";

describe("database log retention policy", () => {
  it("keeps normal, error, and administrator audit logs for separate bounded periods", async () => {
    const retention = await import("@/lib/log-retention") as any;

    expect(typeof retention.normalizeLogRetentionPolicy).toBe("function");
    expect(retention.normalizeLogRetentionPolicy({})).toEqual({
      normalDays: 15,
      errorDays: 30,
      auditDays: 180,
    });
  });

  it("never keeps errors or audit records for less time than normal logs", async () => {
    const retention = await import("@/lib/log-retention") as any;

    expect(retention.normalizeLogRetentionPolicy({
      normalDays: 45,
      errorDays: 10,
      auditDays: 20,
    })).toEqual({
      normalDays: 45,
      errorDays: 45,
      auditDays: 45,
    });
  });

  it("does not inherit the longer business-data retention period", async () => {
    const retention = await import("@/lib/log-retention") as any;

    expect(typeof retention.logRetentionPolicyFromEnv).toBe("function");
    expect(retention.logRetentionPolicyFromEnv({ DATA_RETENTION_DAYS: "180" })).toEqual({
      normalDays: 15,
      errorDays: 30,
      auditDays: 180,
    });
  });

  it("assigns every database log to an expiry rule so future categories cannot grow forever", async () => {
    const retention = await import("@/lib/log-retention") as any;
    const now = new Date("2026-07-28T00:00:00.000Z");

    expect(typeof retention.buildLogRetentionWhere).toBe("function");
    expect(retention.buildLogRetentionWhere({
      normalDays: 15,
      errorDays: 30,
      auditDays: 180,
    }, now)).toEqual({
      OR: [
        {
          category: "admin",
          OR: [
            { restoredAt: { lt: new Date("2026-01-29T00:00:00.000Z") } },
            { restoredAt: null, createdAt: { lt: new Date("2026-01-29T00:00:00.000Z") } },
          ],
        },
        {
          category: { not: "admin" },
          level: "error",
          OR: [
            { restoredAt: { lt: new Date("2026-06-28T00:00:00.000Z") } },
            { restoredAt: null, createdAt: { lt: new Date("2026-06-28T00:00:00.000Z") } },
          ],
        },
        {
          category: { not: "admin" },
          level: { not: "error" },
          OR: [
            { restoredAt: { lt: new Date("2026-07-13T00:00:00.000Z") } },
            { restoredAt: null, createdAt: { lt: new Date("2026-07-13T00:00:00.000Z") } },
          ],
        },
      ],
    });
  });
});
