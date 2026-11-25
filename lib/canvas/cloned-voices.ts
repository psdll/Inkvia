import "server-only";
import { prisma } from "@/lib/prisma";
import type { CanvasMiniMaxVoice } from "./minimax-voice-library";

type SavedVoice = CanvasMiniMaxVoice & { createdAt: number };
type Scope = { userId: number; providerScope: string };
const prefix = ({ userId, providerScope }: Scope) => `canvas_cloned_voice:${userId}:${providerScope}:`;

export async function saveCanvasClonedVoice(input: Scope & { voiceId: string; name: string }) {
  const key = `${prefix(input)}${input.voiceId}`;
  const voice: SavedVoice = {
    id: input.voiceId,
    name: input.name || "我的克隆音色",
    description: "",
    source: "cloned",
    gender: "unknown",
    age: "unknown",
    createdAt: Date.now(),
  };
  const value = JSON.stringify(voice);
  await prisma.appSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
}

export async function listCanvasClonedVoices(input: Scope): Promise<SavedVoice[]> {
  const rows = await prisma.appSetting.findMany({
    where: { key: { startsWith: prefix(input) } },
    orderBy: { updatedAt: "desc" },
    select: { value: true },
  });
  return rows.map(row => JSON.parse(row.value) as SavedVoice);
}

export async function renameCanvasClonedVoice(input: Scope & { voiceId: string; name: string }) {
  const key = `${prefix(input)}${input.voiceId}`;
  const row = await prisma.appSetting.findUnique({ where: { key }, select: { value: true } });
  if (!row) return false;
  const voice = JSON.parse(row.value) as SavedVoice;
  await prisma.appSetting.update({
    where: { key },
    data: { value: JSON.stringify({ ...voice, name: input.name }) },
  });
  return true;
}

export function mergeCanvasClonedVoices(
  remote: CanvasMiniMaxVoice[],
  saved: SavedVoice[],
  now = Date.now(),
) {
  const remoteIds = new Set(remote.map(voice => voice.id));
  const voices = new Map<string, CanvasMiniMaxVoice>();
  for (const voice of saved) {
    if (remoteIds.has(voice.id) || now - voice.createdAt < 7 * 24 * 60 * 60 * 1000) {
      const { createdAt: _createdAt, ...metadata } = voice;
      voices.set(voice.id, { ...metadata, canRename: true, canDelete: true });
    }
  }
  for (const voice of remote) {
    const local = voices.get(voice.id);
    voices.set(voice.id, local ? { ...voice, name: local.name, canRename: true, canDelete: true } : voice);
  }
  return [...voices.values()];
}

export async function deleteCanvasClonedVoice(
  input: Scope & { voiceId: string },
  deleteRemote: (voiceId: string) => Promise<void>,
) {
  const key = `${prefix(input)}${input.voiceId}`;
  const row = await prisma.appSetting.findUnique({ where: { key }, select: { value: true } });
  if (!row || (JSON.parse(row.value) as SavedVoice).source !== "cloned") return false;
  await deleteRemote(input.voiceId);
  await prisma.$transaction([
    prisma.appSetting.deleteMany({ where: { key } }),
    prisma.canvasVoiceFavorite.deleteMany({ where: input }),
  ]);
  return true;
}
