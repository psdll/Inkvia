import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { getRuntimePolicy, RuntimeIsolationError } from "@/lib/runtime-isolation";

// A persistent ceiling for an explicitly authorized test resource, independent of billing.
// Failed/uncertain submissions keep their reservation. Recreating a process cannot reset it.
// Normal business mode never reads or consumes this test-only ceiling.
export async function reserveRuntimeGeneration(requestKey?: string, policy = getRuntimePolicy()) {
  if (policy.profile === "build") throw new RuntimeIsolationError("BUILD_EXTERNAL_IO_DENIED", "generation");
  if (policy.networkMode !== "explicit-test") return;
  const limit = policy.testGenerationLimit!;
  const key = `runtime-generation-budget:${policy.database!.instanceId}`;
  const request = createHash("sha256").update(requestKey || randomUUID()).digest("hex");
  await prisma.$transaction(async tx => {
    await tx.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${key}))::text`);
    const saved = await tx.appSetting.findUnique({ where: { key } });
    let reservations: string[] = [];
    if (saved) {
      try {
        reservations = JSON.parse(saved.value);
        if (!Array.isArray(reservations) || reservations.some(value => !/^[a-f0-9]{64}$/.test(value))) throw new Error();
      } catch { throw new RuntimeIsolationError("ENV_TEST_BUDGET_INVALID", "generation"); }
    }
    if (reservations.includes(request)) return;
    if (reservations.length >= limit) throw new RuntimeIsolationError("ENV_TEST_BUDGET_EXHAUSTED", "generation");
    reservations.push(request);
    await tx.appSetting.upsert({ where: { key }, create: { key, value: JSON.stringify(reservations) }, update: { value: JSON.stringify(reservations) } });
  });
}
