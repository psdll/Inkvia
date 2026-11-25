import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  rolePositioningDraft: {
    findUnique: vi.fn(),
    upsert: vi.fn(),
  },
}));

vi.mock("@/lib/server-auth", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/prisma", () => ({
  default: { rolePositioningDraft: mocks.rolePositioningDraft },
}));

function request(surface: string, init: RequestInit = {}) {
  return new Request(
    `http://localhost/api/role-positioning/draft?surface=${surface}`,
    init,
  ) as any;
}

function storedDraft(overrides: Record<string, unknown> = {}) {
  return {
    id: 11,
    authUserId: 7,
    surface: "toolbox_image",
    systemPrompt: "latest role",
    reversePrompt: "latest result",
    reversePromptApplied: false,
    activeReverseTaskId: 42,
    continuation: {
      kind: "toolbox_image_generation",
      taskId: 42,
      requestKey: "11111111-1111-4111-8111-111111111111",
      phase: "waiting",
    },
    selectedSkillSource: "personal",
    selectedSkillId: BigInt(9),
    resultSkillSource: "system",
    resultSkillId: BigInt(3),
    resultSkillName: "商品精修",
    resultSkillRevision: 4,
    createdAt: new Date("2026-08-04T00:00:00.000Z"),
    updatedAt: new Date("2026-08-04T01:00:00.000Z"),
    ...overrides,
  };
}

describe("account role-positioning draft API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentUser.mockResolvedValue({ id: 7, username: "alice" });
    mocks.rolePositioningDraft.findUnique.mockResolvedValue(storedDraft());
    mocks.rolePositioningDraft.upsert.mockImplementation(async ({ create }: any) =>
      storedDraft(create),
    );
  });

  it("loads a draft by the authenticated account and independent surface", async () => {
    const { GET } = await import("@/app/api/role-positioning/draft/route");

    const response = await GET(request("batch_workbench"));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    await expect(response.clone().json()).resolves.toMatchObject({
      draft: {
        selectedRoleSkillId: "personal:9",
        resultRoleSkill: { id: "system:3", name: "商品精修", revision: 4 },
        continuation: {
          kind: "toolbox_image_generation",
          taskId: 42,
          requestKey: "11111111-1111-4111-8111-111111111111",
          phase: "waiting",
        },
      },
    });
    expect(mocks.rolePositioningDraft.findUnique).toHaveBeenCalledWith({
      where: {
        authUserId_surface: {
          authUserId: 7,
          surface: "batch_workbench",
        },
      },
    });
  });

  it("upserts the latest complete draft without accepting a client user id", async () => {
    const { PUT } = await import("@/app/api/role-positioning/draft/route");

    const response = await PUT(request("batch_workbench", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        authUserId: 999,
        systemPrompt: "new role",
        reversePrompt: "new result",
        reversePromptApplied: true,
        activeReverseTaskId: 99,
        continuation: {
          kind: "batch_segmented_prompts",
          taskId: 99,
          requestKey: "22222222-2222-4222-8222-222222222222",
          phase: "waiting",
          templateBatchId: "33333333-3333-4333-8333-333333333333",
          sharedPrompt: "new role",
          sharedSettings: { model: "gpt-image-2" },
          mediaSnapshots: [],
        },
        selectedRoleSkillId: "system:3",
        resultRoleSkill: { id: "personal:9", name: "广告构图", revision: 2 },
      }),
    }));

    expect(response.status).toBe(200);
    expect(mocks.rolePositioningDraft.upsert).toHaveBeenCalledWith({
      where: {
        authUserId_surface: {
          authUserId: 7,
          surface: "batch_workbench",
        },
      },
      create: {
        authUserId: 7,
        surface: "batch_workbench",
        systemPrompt: "new role",
        reversePrompt: "new result",
        reversePromptApplied: true,
        activeReverseTaskId: 99,
        continuation: {
          kind: "batch_segmented_prompts",
          taskId: 99,
          requestKey: "22222222-2222-4222-8222-222222222222",
          phase: "waiting",
          templateBatchId: "33333333-3333-4333-8333-333333333333",
          sharedPrompt: "new role",
          sharedSettings: { model: "gpt-image-2" },
          mediaSnapshots: [],
        },
        selectedSkillSource: "system",
        selectedSkillId: BigInt(3),
        resultSkillSource: "personal",
        resultSkillId: BigInt(9),
        resultSkillName: "广告构图",
        resultSkillRevision: 2,
      },
      update: {
        systemPrompt: "new role",
        reversePrompt: "new result",
        reversePromptApplied: true,
        activeReverseTaskId: 99,
        continuation: {
          kind: "batch_segmented_prompts",
          taskId: 99,
          requestKey: "22222222-2222-4222-8222-222222222222",
          phase: "waiting",
          templateBatchId: "33333333-3333-4333-8333-333333333333",
          sharedPrompt: "new role",
          sharedSettings: { model: "gpt-image-2" },
          mediaSnapshots: [],
        },
        selectedSkillSource: "system",
        selectedSkillId: BigInt(3),
        resultSkillSource: "personal",
        resultSkillId: BigInt(9),
        resultSkillName: "广告构图",
        resultSkillRevision: 2,
      },
    });
  });

  it("rejects unknown surfaces and unauthenticated access", async () => {
    const { GET, PUT } = await import("@/app/api/role-positioning/draft/route");

    expect((await GET(request("unknown"))).status).toBe(400);
    mocks.getCurrentUser.mockResolvedValue(null);
    expect((await PUT(request("toolbox_image", { method: "PUT" }))).status).toBe(401);
  });

  it("clears a persisted continuation with a database null value", async () => {
    const { PUT } = await import("@/app/api/role-positioning/draft/route");

    const response = await PUT(request("toolbox_image", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ continuation: null }),
    }));

    expect(response.status).toBe(200);
    const update = mocks.rolePositioningDraft.upsert.mock.calls[0]?.[0]?.update;
    expect(update.continuation).toBe(Prisma.DbNull);
  });
});
