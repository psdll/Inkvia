import { beforeEach, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({ upsert: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { appSetting: db } }));
import { saveCanvasClonedVoice, listCanvasClonedVoices, mergeCanvasClonedVoices, renameCanvasClonedVoice } from "@/lib/canvas/cloned-voices";

beforeEach(() => vi.clearAllMocks());
it("persists each voice separately under its owner and provider scope", async () => {
  await saveCanvasClonedVoice({ userId: 42, providerScope: "provider-a", voiceId: "voice-a", name: "我的样本" });
  const args = db.upsert.mock.calls[0][0];
  expect(args.where.key).toBe("canvas_cloned_voice:42:provider-a:voice-a");
  expect(JSON.parse(args.create.value)).toMatchObject({ id: "voice-a", name: "我的样本", source: "cloned" });
});

it("reads only the requested user's provider scope", async () => {
  db.findMany.mockResolvedValue([{ value: JSON.stringify({ id: "voice-a", name: "我的样本", createdAt: 123 }) }]);
  expect(await listCanvasClonedVoices({ userId: 42, providerScope: "provider-a" })).toHaveLength(1);
  expect(db.findMany.mock.calls[0][0].where.key.startsWith).toBe("canvas_cloned_voice:42:provider-a:");
});

it("keeps unactivated voices for seven days and deduplicates activated ones", () => {
  const now = 10 * 24 * 60 * 60 * 1000;
  const metadata = { description: "", gender: "unknown" as const, age: "unknown" as const };
  const saved = [
    { ...metadata, id: "new", name: "新音色", createdAt: now - 1000, source: "cloned" as const },
    { ...metadata, id: "expired", name: "过期", createdAt: 0, source: "cloned" as const },
    { ...metadata, id: "active", name: "我的名称", createdAt: 0, source: "cloned" as const },
  ];
  const merged = mergeCanvasClonedVoices([{ ...metadata, id: "active", name: "active", source: "cloned" }], saved, now);
  expect(merged.map(v => v.id)).toEqual(["new", "active"]);
  expect(merged[1].name).toBe("我的名称");
  expect(merged.every(voice => voice.canRename)).toBe(true);
});

it("renames only an owned voice and preserves its original expiry clock", async () => {
  db.findUnique.mockResolvedValue({ value: JSON.stringify({ id: "voice-a", name: "旧名", createdAt: 123 }) });
  expect(await renameCanvasClonedVoice({ userId: 42, providerScope: "provider-a", voiceId: "voice-a", name: "新名" })).toBe(true);
  expect(db.findUnique.mock.calls[0][0].where.key).toBe("canvas_cloned_voice:42:provider-a:voice-a");
  expect(JSON.parse(db.update.mock.calls[0][0].data.value)).toEqual({ id: "voice-a", name: "新名", createdAt: 123 });
});

it("does not create a rename record for voices outside the owner scope", async () => {
  db.findUnique.mockResolvedValue(null);
  expect(await renameCanvasClonedVoice({ userId: 99, providerScope: "provider-a", voiceId: "voice-a", name: "新名" })).toBe(false);
  expect(db.update).not.toHaveBeenCalled();
  expect(db.upsert).not.toHaveBeenCalled();
});
