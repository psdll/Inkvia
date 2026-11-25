import { describe, expect, it, vi } from "vitest";
import { deleteAdminUserCanvasAndAccount } from "@/lib/admin-user-delete";

function createDeleteClient(userDeleteCount = 1) {
  const calls: string[] = [];
  const remove = (name: string, count: number) =>
    vi.fn(async () => {
      calls.push(name);
      return { count };
    });

  return {
    calls,
    client: {
      $queryRaw: vi.fn(async () => {
        calls.push("promptLock");
        return [];
      }),
      userBuiltinPromptDeletion: {
        deleteMany: remove("userBuiltinPromptDeletion", 7),
      },
      promptPresetMigrationState: {
        deleteMany: remove("promptPresetMigrationState", 8),
        upsert: vi.fn(),
      },
      promptPreset: { deleteMany: remove("promptPreset", 9) },
      userRoleSkill: {
        findMany: vi.fn(async () => {
          calls.push("userRoleSkillFind");
          return [{ coverUrl: "/uploads/role_skill_covers/users/7/cover.webp" }];
        }),
        deleteMany: remove("userRoleSkill", 10),
      },
      canvas: { deleteMany: remove("canvas", 2) },
      canvasProject: { deleteMany: remove("canvasProject", 1) },
      canvasMutation: { deleteMany: remove("canvasMutation", 3) },
      canvasMember: { deleteMany: remove("canvasMember", 4) },
      imageBatch: { deleteMany: remove("imageBatch", 6) },
      toolWorkspaceDraft: { deleteMany: remove("toolWorkspaceDraft", 11) },
      mediaAsset: { deleteMany: remove("mediaAsset", 5) },
      user: { deleteMany: remove("user", userDeleteCount) },
    },
  };
}

describe("admin user canvas deletion", () => {
  it("deletes all canvas-owned data before deleting the user account", async () => {
    const { calls, client } = createDeleteClient();

    const result = await deleteAdminUserCanvasAndAccount(client, 7);

    expect(calls).toEqual([
      "promptLock",
      "userBuiltinPromptDeletion",
      "promptPresetMigrationState",
      "promptPreset",
      "userRoleSkillFind",
      "userRoleSkill",
      "canvas",
      "canvasProject",
      "canvasMutation",
      "canvasMember",
      "imageBatch",
      "toolWorkspaceDraft",
      "mediaAsset",
      "user",
    ]);
    expect(result).toEqual({
      deletedBuiltinPromptDeletions: 7,
      deletedPromptPresetMigrationStates: 8,
      deletedPromptPresets: 9,
      deletedUserRoleSkills: 10,
      roleSkillCoverRefs: ["/uploads/role_skill_covers/users/7/cover.webp"],
      deletedCanvases: 2,
      deletedCanvasProjects: 1,
      deletedCanvasMutations: 3,
      deletedCanvasMemberships: 4,
      deletedImageBatches: 6,
      deletedToolWorkspaceDrafts: 11,
      deletedCanvasMediaAssets: 5,
      deletedUsers: 1,
    });
  });

  it("allows an interrupted user deletion to be retried after the account row is already gone", async () => {
    const { client } = createDeleteClient(0);

    await expect(deleteAdminUserCanvasAndAccount(client, 7)).resolves.toMatchObject({
      deletedUsers: 0,
    });
  });
});
