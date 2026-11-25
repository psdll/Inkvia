import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireCanvasEntryEnabled: vi.fn(),
  getUserId: vi.fn(),
  findFirst: vi.fn(),
  recoverStaleProcessingGeneration: vi.fn(),
  finalizeGeneration: vi.fn(),
}));


vi.mock("@/lib/server-auth", () => ({ getUserId: mocks.getUserId }));

vi.mock("@/lib/prisma", () => ({
  default: { generation: { findFirst: mocks.findFirst } },
}));

vi.mock("@/lib/media-url", () => ({ normalizeMediaUrl: (value: string) => value }));
vi.mock("@/lib/error-friendly", () => ({ friendlyErrorPrimaryText: (value: string) => value }));

vi.mock("@/lib/generation/finalize", () => ({
  FINALIZE_PROVIDERS: ["minimax"],
  isInProgressStatus: (status: string) =>
    ["running", "queued", "pending", "processing", "submitted"].includes(status),
  recoverStaleProcessingGeneration: mocks.recoverStaleProcessingGeneration,
  finalizeGeneration: mocks.finalizeGeneration,
}));

describe("canvas generation stale processing recovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireCanvasEntryEnabled.mockResolvedValue(null);
    mocks.getUserId.mockResolvedValue(29);
    mocks.findFirst.mockResolvedValue({
      id: 31652,
      status: "processing",
      localPath: null,
      errorMsg: null,
      externalProvider: "minimax",
    });
    mocks.recoverStaleProcessingGeneration.mockResolvedValue(1);
    mocks.finalizeGeneration.mockResolvedValue("success");
  });

  it("recovers a stale processing claim and resumes finalization", async () => {
    const { GET } = await import("@/app/api/canvas/generation/[id]/route");

    await GET(new Request("http://localhost/api/canvas/generation/31652") as any, {
      params: { id: "31652" },
    });

    await vi.waitFor(() => {
      expect(mocks.recoverStaleProcessingGeneration).toHaveBeenCalledWith(31652);
      expect(mocks.finalizeGeneration).toHaveBeenCalledWith(31652);
    });
  });

  it("does not interrupt a processing claim whose lease is still fresh", async () => {
    mocks.findFirst.mockResolvedValue({
      id: 31653,
      status: "processing",
      localPath: null,
      errorMsg: null,
      externalProvider: "minimax",
    });
    mocks.recoverStaleProcessingGeneration.mockResolvedValue(0);
    const { GET } = await import("@/app/api/canvas/generation/[id]/route");

    await GET(new Request("http://localhost/api/canvas/generation/31653") as any, {
      params: { id: "31653" },
    });

    await vi.waitFor(() => {
      expect(mocks.recoverStaleProcessingGeneration).toHaveBeenCalledWith(31653);
    });
    expect(mocks.finalizeGeneration).not.toHaveBeenCalled();
  });
});
