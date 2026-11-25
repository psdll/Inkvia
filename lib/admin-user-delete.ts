type DeleteManyDelegate = {
  deleteMany(args: any): PromiseLike<{ count: number }>;
};

type FindManyDelegate = {
  findMany(args: any): PromiseLike<Array<Record<string, any>>>;
};

type UpsertDelegate = {
  upsert(args: any): PromiseLike<unknown>;
};

type AdminUserDeleteClient = {
  $queryRaw(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): PromiseLike<unknown>;
  userBuiltinPromptDeletion: DeleteManyDelegate;
  promptPresetMigrationState: DeleteManyDelegate & UpsertDelegate;
  promptPreset: DeleteManyDelegate;
  userRoleSkill: DeleteManyDelegate & FindManyDelegate;
  canvas: DeleteManyDelegate;
  canvasProject: DeleteManyDelegate;
  canvasMutation: DeleteManyDelegate;
  canvasMember: DeleteManyDelegate;
  imageBatch: DeleteManyDelegate;
  liveVideoBatch?: DeleteManyDelegate;
  toolWorkspaceDraft: DeleteManyDelegate;
  mediaAsset: DeleteManyDelegate;
  user: DeleteManyDelegate;
};

export async function resetAdminUserPromptPresetData(
  client: Pick<
    AdminUserDeleteClient,
    "$queryRaw"
    | "userBuiltinPromptDeletion"
    | "promptPresetMigrationState"
    | "promptPreset"
  >,
  input: {
    authUserId: number;
    marker: { version: number; digest: string } | null;
  },
) {
  const { authUserId } = input;
  const subjectKey = `user:${authUserId}:user-json`;
  await client.$queryRaw`
    SELECT pg_advisory_xact_lock(hashtext(${subjectKey}))::text
  `;
  const deletedBuiltinPromptDeletions =
    await client.userBuiltinPromptDeletion.deleteMany({
      where: { authUserId },
    });
  const deletedPromptPresetMigrationStates =
    await client.promptPresetMigrationState.deleteMany({
      where: { authUserId },
    });
  const deletedPromptPresets = await client.promptPreset.deleteMany({
    where: { authUserId },
  });

  if (input.marker) {
    const marker = {
      subjectKey,
      authUserId,
      source: "user-json",
      version: input.marker.version,
      digest: input.marker.digest,
      rowCount: 0,
      completedAt: new Date(),
    };
    await client.promptPresetMigrationState.upsert({
      where: { subjectKey },
      create: marker,
      update: marker,
    });
  }

  return {
    deletedBuiltinPromptDeletions: deletedBuiltinPromptDeletions.count,
    deletedPromptPresetMigrationStates:
      deletedPromptPresetMigrationStates.count,
    deletedPromptPresets: deletedPromptPresets.count,
  };
}

export async function resetAdminUserRoleSkillData(
  client: Pick<AdminUserDeleteClient, "userRoleSkill">,
  input: { authUserId: number },
) {
  const personalCoverPrefix = `/uploads/role_skill_covers/users/${input.authUserId}/`;
  const rows = await client.userRoleSkill.findMany({
    where: { authUserId: input.authUserId },
    select: { coverUrl: true },
  });
  const deleted = await client.userRoleSkill.deleteMany({
    where: { authUserId: input.authUserId },
  });
  return {
    deletedUserRoleSkills: deleted.count,
    roleSkillCoverRefs: Array.from(new Set(
      rows
        .map((row) => String(row.coverUrl || "").trim())
        .filter((coverUrl) => coverUrl.startsWith(personalCoverPrefix)),
    )),
  };
}

export async function deleteAdminUserCanvasAndAccount(
  client: AdminUserDeleteClient,
  authUserId: number,
) {
  const promptDeletion = await resetAdminUserPromptPresetData(client, {
    authUserId,
    marker: null,
  });
  const roleSkillDeletion = await resetAdminUserRoleSkillData(client, {
    authUserId,
  });
  const deletedCanvases = await client.canvas.deleteMany({
    where: { authUserId },
  });
  const deletedCanvasProjects = await client.canvasProject.deleteMany({
    where: { authUserId },
  });
  const deletedCanvasMutations = await client.canvasMutation.deleteMany({
    where: { actorUserId: authUserId },
  });
  const deletedCanvasMemberships = await client.canvasMember.deleteMany({
    where: { userId: authUserId },
  });
  const deletedImageBatches = await client.imageBatch.deleteMany({
    where: { authUserId },
  });
  const deletedLiveVideoBatches = client.liveVideoBatch
    ? await client.liveVideoBatch.deleteMany({ where: { authUserId } })
    : { count: 0 };
  const deletedToolWorkspaceDrafts = await client.toolWorkspaceDraft.deleteMany({
    where: { authUserId },
  });
  const deletedCanvasMediaAssets = await client.mediaAsset.deleteMany({
    where: { ownerUserId: authUserId },
  });
  const deletedUsers = await client.user.deleteMany({
    where: { id: authUserId },
  });

  return {
    ...promptDeletion,
    ...roleSkillDeletion,
    deletedCanvases: deletedCanvases.count,
    deletedCanvasProjects: deletedCanvasProjects.count,
    deletedCanvasMutations: deletedCanvasMutations.count,
    deletedCanvasMemberships: deletedCanvasMemberships.count,
    deletedImageBatches: deletedImageBatches.count,
    ...(client.liveVideoBatch
      ? { deletedLiveVideoBatches: deletedLiveVideoBatches.count }
      : {}),
    deletedToolWorkspaceDrafts: deletedToolWorkspaceDrafts.count,
    deletedCanvasMediaAssets: deletedCanvasMediaAssets.count,
    deletedUsers: deletedUsers.count,
  };
}
