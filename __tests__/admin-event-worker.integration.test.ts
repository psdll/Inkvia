import { afterAll, describe, expect, it } from "vitest";
import prisma from "@/lib/prisma";
import { processAdminEvents } from "@/lib/admin-operational";

const integrationIt = process.env.RUN_ADMIN_EVENT_DB_TEST === "1" ? it : it.skip;

describe("admin event worker database integration", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  integrationIt("projects a committed Generation trigger event and marks it done", async () => {
    const generation = await prisma.generation.findFirst({ orderBy: { id: "desc" }, select: { id: true } });
    expect(generation).not.toBeNull();
    await prisma.$executeRawUnsafe(
      `UPDATE "Generation" SET "updatedAt" = "updatedAt" WHERE "id" = $1`,
      generation!.id,
    );
    const event = await prisma.adminEvent.findFirst({
      where: { entityType: "generation", entityId: String(generation!.id) },
      orderBy: { id: "desc" },
    });
    expect(event?.eventType).toBe("generation.update");

    const result = await processAdminEvents(100, { workerId: "vitest-integration" });
    const [processed, feed, source] = await Promise.all([
      prisma.adminEvent.findUnique({ where: { id: event!.id } }),
      prisma.adminWorkFeed.findUnique({ where: { generationId: generation!.id } }),
      prisma.generation.findUnique({
        where: { id: generation!.id },
        select: { createdAt: true, finishedAt: true, updatedAt: true },
      }),
    ]);

    expect(result.failed).toBe(0);
    expect(processed).toEqual(expect.objectContaining({ status: "done", attempts: 1 }));
    expect(feed).toEqual(expect.objectContaining({ sourceEventId: event!.id, deletedAt: null }));
    expect(feed?.createdAt).toEqual(source?.createdAt);
    expect(feed?.finishedAt).toEqual(source?.finishedAt);
    expect(feed?.updatedAt).toEqual(source?.updatedAt);
  });

  integrationIt("processes insert, update and delete in event-id order and writes a tombstone", async () => {
    const marker = `__admin_event_test_${Date.now()}`;
    let generationId = 0;
    try {
      const created = await prisma.generation.create({
        data: {
          userId: marker,
          type: "image_edit",
          source: "tool",
          prompt: "admin event integration test",
          status: "pending",
        },
      });
      generationId = created.id;
      await prisma.generation.update({ where: { id: generationId }, data: { status: "success" } });
      await prisma.generation.delete({ where: { id: generationId } });

      const events = await prisma.adminEvent.findMany({
        where: { entityType: "generation", entityId: String(generationId) },
        orderBy: { id: "asc" },
      });
      expect(events.map((event) => event.eventType)).toEqual([
        "generation.insert",
        "generation.update",
        "generation.delete",
      ]);

      const result = await processAdminEvents(100, { workerId: "vitest-integration" });
      const [processedEvents, tombstone] = await Promise.all([
        prisma.adminEvent.findMany({
          where: { id: { in: events.map((event) => event.id) } },
          orderBy: { id: "asc" },
        }),
        prisma.adminWorkFeed.findUnique({ where: { generationId } }),
      ]);

      expect(result.failed).toBe(0);
      expect(processedEvents.every((event) => event.status === "done")).toBe(true);
      expect(tombstone).toEqual(expect.objectContaining({
        sourceEventId: events[2].id,
        userId: marker,
        status: "deleted",
      }));
      expect(tombstone?.deletedAt).not.toBeNull();
    } finally {
      if (generationId) {
        await prisma.adminWorkFeed.deleteMany({ where: { generationId } });
        await prisma.adminEvent.deleteMany({ where: { entityType: "generation", entityId: String(generationId) } });
        await prisma.generation.deleteMany({ where: { id: generationId } });
      }
    }
  });
});
