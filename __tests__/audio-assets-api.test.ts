import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const db = vi.hoisted(() => ({
  generation: { findMany: vi.fn() }, $queryRaw: vi.fn(),
  log: { findMany: vi.fn(async () => []) },
  generationInputMedia: { findMany: vi.fn(async () => []) },
  imageBatchOutput: { findMany: vi.fn(async () => []) },
  liveVideoBatchOutput: { findMany: vi.fn(async () => []) },
}));
vi.mock("@/lib/prisma", () => ({ default: db }));
vi.mock("@/lib/server-auth", () => ({ getUserId: vi.fn(async () => 7) }));
vi.mock("@/lib/admin-auth", () => ({ isAdminRequest: () => false }));
vi.mock("@/lib/inspiration-template-service", () => ({ getUserInspirationTemplatesByGenerationIds: vi.fn(async () => new Map()) }));
import { GET } from "@/app/api/assets/route";

describe("audio assets API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.generation.findMany.mockResolvedValue([]);
    db.$queryRaw.mockResolvedValue([{ total: BigInt(1) }]);
  });

  it("includes audio formats in the owner-scoped paginated query", async () => {
    await GET(new NextRequest("http://localhost/api/assets?type=audio&source=canvas"));
    const { where } = db.generation.findMany.mock.calls[0][0];
    expect(where.AND).toContainEqual({ type: "audio_gen" });
    expect(where.AND).toContainEqual({ source: "canvas" });
    expect(where.AND).toContainEqual({ status: "success" });
    for (const ext of ["mp3", "wav", "m4a", "aac", "ogg", "flac"]) {
      expect(JSON.stringify(where)).toContain(`"endsWith":".${ext}"`);
    }
    expect(JSON.stringify(where)).toContain('"authUserId":7');
    expect(JSON.stringify(where)).toContain("canvas_voice_previews");
  });

  it("counts audio with the same SQL filters before pagination", async () => {
    const response = await GET(new NextRequest("http://localhost/api/assets?type=audio&count=1"));
    expect(await response.json()).toEqual({ total: 1 });
    const sqlWhere = db.$queryRaw.mock.calls[0][1];
    expect(sqlWhere.values).toContain("audio_gen");
    expect(sqlWhere.values).toContain("%.mp3");
    expect(sqlWhere.values.some((value: unknown) => String(value).includes("canvas_voice_previews"))).toBe(true);
  });

  it("hydrates existing audio records without requiring regeneration", async () => {
    db.generation.findMany.mockResolvedValue([{ id: 7, authUserId: 7, userId: "7", type: "audio_gen", status: "success",
      source: "canvas", localPath: "/uploads/canvas_audio_results/old.mp3", prompt: "旧结果", model: "speech-2.8-hd",
      createdAt: new Date(), templateData: JSON.stringify({ voiceId: "voice-a", speed: 1.2 }), externalTaskId: null }]);
    const response = await GET(new NextRequest("http://localhost/api/assets"));
    const body = await response.json();
    expect(body.items[0]).toMatchObject({ id: 7, type: "audio_gen", displayKind: "audio", thumbUrl: null,
      outputPaths: ["/uploads/canvas_audio_results/old.mp3"], params: { voiceId: "voice-a", speed: 1.2 } });
  });
});
