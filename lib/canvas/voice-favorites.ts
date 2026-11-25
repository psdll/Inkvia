import "server-only";

import { prisma } from "@/lib/prisma";

export async function listCanvasVoiceFavorites(input: {
  userId: number;
  providerScope: string;
}) {
  const rows = await prisma.canvasVoiceFavorite.findMany({
    where: input,
    orderBy: { createdAt: "asc" },
    select: { voiceId: true },
  });
  return rows.map((row) => row.voiceId);
}

export async function setCanvasVoiceFavorite(input: {
  userId: number;
  providerScope: string;
  voiceId: string;
  favorite: boolean;
}) {
  const key = {
    userId_providerScope_voiceId: {
      userId: input.userId,
      providerScope: input.providerScope,
      voiceId: input.voiceId,
    },
  };
  if (input.favorite) {
    await prisma.canvasVoiceFavorite.upsert({
      where: key,
      update: {},
      create: {
        userId: input.userId,
        providerScope: input.providerScope,
        voiceId: input.voiceId,
      },
    });
    return;
  }
  await prisma.canvasVoiceFavorite.deleteMany({
    where: key.userId_providerScope_voiceId,
  });
}
