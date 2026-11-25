import { describe, expect, it } from "vitest";

describe("generation finalizer scheduling", () => {
  it("filters due work in the database before applying the batch limit", async () => {
    const module = await import("@/lib/generation/finalize-scheduler").catch(() => null);
    expect(module).not.toBeNull();

    const now = new Date("2026-07-30T10:00:00.000Z");
    const query = module!.buildGenerationFinalizeCandidateQuery(now, {
      providers: ["kie"],
      statuses: ["running"],
      take: 10,
    });

    expect(query.take).toBe(10);
    expect(query.where).toMatchObject({
      status: { in: ["running"] },
      AND: [{ OR: [{ externalProvider: { in: ["kie"] } }, { templateData: { contains: '"agentOutputRecovery":' } }] }],
      OR: [
        { createdAt: { gte: new Date("2026-07-30T09:59:00.000Z") } },
        { updatedAt: { lte: new Date("2026-07-30T09:59:58.000Z") } },
      ],
    });
    expect(query.orderBy).toEqual([
      { updatedAt: "asc" },
      { createdAt: "asc" },
    ]);
  });

  it("finds stale tasks across every provider after the type-specific deadline", async () => {
    const module = await import("@/lib/generation/finalize-scheduler").catch(() => null);
    expect(module).not.toBeNull();

    const now = new Date("2026-07-30T10:00:00.000Z");
    const query = module!.buildGenerationStaleCandidateQuery(now, {
      statuses: ["running", "pending"],
      imageMaxAgeMs: 15 * 60 * 1000,
      defaultMaxAgeMs: 30 * 60 * 1000,
      take: 50,
    });

    expect(query.where).toEqual({
      status: { in: ["running", "pending"] },
      localPath: null,
      OR: [
        {
          type: "image_edit",
          createdAt: { lte: new Date(now.getTime() - 15 * 60 * 1000) },
        },
        {
          type: { not: "image_edit" },
          createdAt: { lte: new Date(now.getTime() - 30 * 60 * 1000) },
        },
      ],
    });
    expect(query.where).not.toHaveProperty("externalProvider");
    expect(query).toMatchObject({
      take: 50,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true },
    });
  });
});
