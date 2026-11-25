import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import prisma from "@/lib/prisma";
import { getRuntimePolicy } from "@/lib/runtime-isolation";
import { reserveRuntimeGeneration } from "@/lib/runtime-generation-budget";
const integration = process.env.RUN_P0_DB_TESTS === "1" ? it : it.skip;
const keys: string[] = [];
afterAll(async () => { if (keys.length) await prisma.appSetting.deleteMany({ where: { key: { in: keys } } }); await prisma.$disconnect(); });
describe("persistent isolated generation ceiling", () => {
  integration("counts concurrent unique requests once and cannot reset by changing the policy fingerprint", async () => {
    const base = getRuntimePolicy();
    const policy = { ...base, networkMode: "explicit-test" as const, testGenerationLimit: 2, database: { ...base.database, instanceId: `budget-${randomUUID()}` } };
    keys.push(`runtime-generation-budget:${policy.database.instanceId}`);
    const results = await Promise.allSettled([reserveRuntimeGeneration("a", policy), reserveRuntimeGeneration("a", policy), reserveRuntimeGeneration("b", policy), reserveRuntimeGeneration("c", policy)]);
    expect(results.filter(result => result.status === "rejected")).toHaveLength(1);
    const saved = JSON.parse((await prisma.appSetting.findUniqueOrThrow({ where: { key: keys[0] } })).value);
    expect(saved).toHaveLength(2);
    await expect(reserveRuntimeGeneration("another", { ...policy, fingerprint: "changed" })).rejects.toThrow("ENV_TEST_BUDGET_EXHAUSTED");
  });
});
