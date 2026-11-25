import { afterAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { guardPrismaClient, getRuntimePolicy } from "../scripts/lib/runtime-isolation.cjs";

const enabled = process.env.RUN_P0_DB_TESTS === "1";
const integration = enabled ? it : it.skip;
const clients: PrismaClient[] = [];
function client(wrongIdentity = false) {
  const policy = getRuntimePolicy();
  const guarded = guardPrismaClient(new PrismaClient(), wrongIdentity ? { ...policy, database: { ...policy.database, instanceId: "wrong-synthetic-instance" } } : policy);
  clients.push(guarded); return guarded;
}
afterAll(async () => { await Promise.all(clients.map(db => db.$disconnect())); });
describe("Prisma 6.19.3 isolation barrier integration", () => {
  integration("covers model, raw and both transaction APIs on the allowed instance", async () => {
    const db = client();
    expect(await db.user.count()).toBeTypeOf("number");
    expect(await db.$queryRaw`SELECT 1 AS value`).toEqual([{ value: 1 }]);
    expect(await db.$transaction([db.$queryRaw`SELECT 2 AS value`, db.user.count()])).toEqual([[{ value: 2 }], expect.any(Number)]);
    const result = await db.$transaction(async tx => {
      await tx.$executeRawUnsafe('CREATE TEMP TABLE p0_barrier_probe (value INTEGER) ON COMMIT DROP');
      await tx.$executeRawUnsafe('INSERT INTO p0_barrier_probe VALUES (3)');
      return tx.$queryRawUnsafe('SELECT * FROM p0_barrier_probe');
    }, { timeout: 10000 });
    expect(result).toEqual([{ value: 3 }]);
  });
  integration("rejects model, raw, connect and transactions before business queries on an identity mismatch", async () => {
    const db = client(true);
    await expect(db.$connect()).rejects.toThrow("ENV_IDENTITY_UNVERIFIED");
    await expect(db.user.count()).rejects.toThrow("ENV_IDENTITY_UNVERIFIED");
    await expect(db.$executeRawUnsafe('SELECT 1')).rejects.toThrow("ENV_IDENTITY_UNVERIFIED");
    await expect(db.$queryRawUnsafe('SELECT 1')).rejects.toThrow("ENV_IDENTITY_UNVERIFIED");
    let entered = false;
    await expect(db.$transaction(async () => { entered = true; })).rejects.toThrow("ENV_IDENTITY_UNVERIFIED");
    expect(entered).toBe(false);
  });
});
