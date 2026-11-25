type DeleteManyResult = { count: number };

type DeleteManyDelegate = {
  deleteMany(args: any): PromiseLike<DeleteManyResult>;
};

type FindManyDelegate = {
  findMany(args: any): PromiseLike<Array<Record<string, any>>>;
};

type GenerationPhysicalDeleteClient = {
  generation: DeleteManyDelegate;
  adminAssetFeed?: {
    updateMany(args: any): PromiseLike<DeleteManyResult>;
  };
  adminWorkFeed?: {
    updateMany(args: any): PromiseLike<DeleteManyResult>;
  };
  imageBatchOutput: DeleteManyDelegate & FindManyDelegate;
  imageBatchMedia?: FindManyDelegate;
  imageBatchItem: DeleteManyDelegate;
  imageBatchGroup: DeleteManyDelegate;
  liveVideoBatchOutput?: DeleteManyDelegate & FindManyDelegate;
  liveVideoBatchItem?: DeleteManyDelegate & Partial<FindManyDelegate>;
  liveVideoBatch?: DeleteManyDelegate;
  generationInputMedia?: FindManyDelegate;
  mediaReference?: DeleteManyDelegate & FindManyDelegate;
  mediaAsset?: {
    updateMany(args: any): PromiseLike<DeleteManyResult>;
  };
};

type GenerationOutputMediaReference = {
  mediaId: string;
  sourceId: string;
};

const RELEASE_GRACE_MS = 10 * 60 * 1000;

function uniqueStrings(values: unknown[]) {
  return Array.from(new Set(values.map((value) => String(value || "").trim()).filter(Boolean)));
}

function uniqueGenerationIds(values: number[]) {
  return Array.from(new Set(values.filter((value) => Number.isSafeInteger(value) && value > 0)));
}

/**
 * Removes every batch task card backed by the target generations, then removes
 * the Generation rows. This deliberately uses only tables that already exist in
 * production, so deploying the new code does not depend on a schema migration.
 *
 * The caller must execute this function inside the same database transaction as
 * its logs, ledger and admin-feed changes. Physical files are deleted only after
 * that transaction commits.
 */
export async function deleteGenerationRowsAndBatchCards(
  client: GenerationPhysicalDeleteClient,
  generationIds: number[],
) {
  const ids = uniqueGenerationIds(generationIds);
  if (!ids.length) {
    return {
      generations: 0,
      imageOutputs: 0,
      imageItems: 0,
      imageGroups: 0,
      liveOutputs: 0,
      liveItems: 0,
      liveBatches: 0,
      mediaReleased: 0,
      generationOutputMediaIds: [] as string[],
      generationOutputMedia: [] as Array<{ generationId: number; mediaId: string }>,
    };
  }

  const imageOutputs = await client.imageBatchOutput.findMany({
    where: { generationId: { in: ids } },
    select: { itemId: true, item: { select: { groupId: true } } },
  });
  const imageItemIds = uniqueStrings(imageOutputs.map((output) => output.itemId));
  const imageGroupIds = uniqueStrings(imageOutputs.map((output) => output.item?.groupId));
  const imageMedia = imageItemIds.length && client.imageBatchMedia
    ? await client.imageBatchMedia.findMany({
        where: { itemId: { in: imageItemIds } },
        select: { mediaId: true },
      })
    : [];

  let liveOutputs: Array<Record<string, any>> = [];
  if (client.liveVideoBatchOutput) {
    liveOutputs = await client.liveVideoBatchOutput.findMany({
      where: { generationId: { in: ids } },
      select: { itemId: true, batchId: true },
    });
  }
  const liveItemIds = uniqueStrings(liveOutputs.map((output) => output.itemId));
  const liveBatchIds = uniqueStrings(liveOutputs.map((output) => output.batchId));
  const liveItems = liveItemIds.length && client.liveVideoBatchItem?.findMany
    ? await client.liveVideoBatchItem.findMany({
        where: { id: { in: liveItemIds } },
        select: { sourceMediaId: true },
      })
    : [];
  const generationInputMedia = client.generationInputMedia
    ? await client.generationInputMedia.findMany({
        where: { generationId: { in: ids } },
        select: { mediaId: true },
      })
    : [];
  const generationSourceIds = ids.map((id) => `generation:${id}:0`);
  const generationMediaReferences: GenerationOutputMediaReference[] = client.mediaReference
    ? await client.mediaReference.findMany({
        where: { sourceType: "generation", sourceId: { in: generationSourceIds } },
        select: { mediaId: true, sourceId: true },
      }) as GenerationOutputMediaReference[]
    : [];
  const releasedMediaIds = uniqueStrings([
    ...imageMedia.map((entry) => entry.mediaId),
    ...liveItems.map((entry) => entry.sourceMediaId),
    ...generationInputMedia.map((entry) => entry.mediaId),
    ...generationMediaReferences.map((entry) => entry.mediaId),
  ]);

  const now = new Date();
  await client.adminAssetFeed?.updateMany({
    where: { generationId: { in: ids } },
    data: { status: "deleted", deletedAt: now, updatedAt: now },
  });
  await client.adminWorkFeed?.updateMany({
    where: { generationId: { in: ids } },
    data: { status: "deleted", deletedAt: now, updatedAt: now },
  });

  // Remove every output of the affected task before deleting its card. A task
  // card cannot survive after any one of its physical works has been deleted.
  const imageOutputsDeleted = imageItemIds.length
    ? await client.imageBatchOutput.deleteMany({ where: { itemId: { in: imageItemIds } } })
    : { count: 0 };
  const imageItemsDeleted = imageItemIds.length
    ? await client.imageBatchItem.deleteMany({ where: { id: { in: imageItemIds } } })
    : { count: 0 };
  const imageGroupsDeleted = imageGroupIds.length
    ? await client.imageBatchGroup.deleteMany({
        where: { id: { in: imageGroupIds }, items: { none: {} } },
      })
    : { count: 0 };

  const liveOutputsDeleted = liveItemIds.length && client.liveVideoBatchOutput
    ? await client.liveVideoBatchOutput.deleteMany({ where: { itemId: { in: liveItemIds } } })
    : { count: 0 };
  const liveItemsDeleted = liveItemIds.length && client.liveVideoBatchItem
    ? await client.liveVideoBatchItem.deleteMany({ where: { id: { in: liveItemIds } } })
    : { count: 0 };
  const liveBatchesDeleted = liveBatchIds.length && client.liveVideoBatch
    ? await client.liveVideoBatch.deleteMany({
        where: { id: { in: liveBatchIds }, items: { none: {} } },
      })
    : { count: 0 };

  const generationsDeleted = await client.generation.deleteMany({
    where: { id: { in: ids } },
  });
  if (client.mediaReference && generationSourceIds.length) {
    await client.mediaReference.deleteMany({
      where: { sourceType: "generation", sourceId: { in: generationSourceIds } },
    });
  }

  // GenerationInputMedia is cascaded by the Generation delete above. Releasing
  // input assets before that point would incorrectly see a live reference and
  // leave the media in ready state forever.
  const mediaReleased = releasedMediaIds.length && client.mediaAsset
    ? await client.mediaAsset.updateMany({
        where: {
          id: { in: releasedMediaIds },
          status: "ready",
          purgedAt: null,
          workspaceDraftMedia: { none: {} },
          batchMedia: { none: {} },
          liveVideoBatchItems: { none: {} },
          generationInputs: { none: {} },
          references: { none: {} },
          runOutputs: { none: {} },
        },
        data: {
          status: "soft_deleted",
          softDeletedAt: new Date(),
          retentionUntil: new Date(Date.now() + RELEASE_GRACE_MS),
          leaseOwner: null,
          leaseUntil: null,
          referenceCount: 0,
        },
      })
    : { count: 0 };

  return {
    generations: Number(generationsDeleted.count || 0),
    imageOutputs: Number(imageOutputsDeleted.count || 0),
    imageItems: Number(imageItemsDeleted.count || 0),
    imageGroups: Number(imageGroupsDeleted.count || 0),
    liveOutputs: Number(liveOutputsDeleted.count || 0),
    liveItems: Number(liveItemsDeleted.count || 0),
    liveBatches: Number(liveBatchesDeleted.count || 0),
    mediaReleased: Number(mediaReleased.count || 0),
    generationOutputMediaIds: uniqueStrings(generationMediaReferences.map((entry) => entry.mediaId)),
    generationOutputMedia: generationMediaReferences.map((entry) => ({
      generationId: Number(entry.sourceId.split(":")[1] || 0),
      mediaId: entry.mediaId,
    })),
  };
}

/**
 * User/account deletion already removes whole ImageBatch and LiveVideoBatch
 * aggregates later in its workflow. This smaller helper only detaches their
 * output links before Generation rows are deleted, preventing SetNull residue
 * during the interval between those operations.
 */
export async function deleteGenerationOutputLinks(
  client: Pick<GenerationPhysicalDeleteClient, "imageBatchOutput" | "liveVideoBatchOutput">,
  generationIds: number[],
) {
  const ids = uniqueGenerationIds(generationIds);
  if (!ids.length) return { imageOutputs: 0, liveOutputs: 0 };
  const imageOutputs = await client.imageBatchOutput.deleteMany({
    where: { generationId: { in: ids } },
  });
  const liveOutputs = client.liveVideoBatchOutput
    ? await client.liveVideoBatchOutput.deleteMany({ where: { generationId: { in: ids } } })
    : { count: 0 };
  return {
    imageOutputs: Number(imageOutputs.count || 0),
    liveOutputs: Number(liveOutputs.count || 0),
  };
}
