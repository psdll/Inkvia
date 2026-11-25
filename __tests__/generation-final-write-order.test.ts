import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  recoveryRead: vi.fn(),
  recoveryRemove: vi.fn(async()=>undefined),
  findUnique: vi.fn(),
  findFirst: vi.fn(),
  updateMany: vi.fn(),
  update: vi.fn(),
  create: vi.fn(),
  kieGetTaskDetail: vi.fn(),
  apimartGetTask: vi.fn(),
  workFisherGetImageTask: vi.fn(),
  bailianGetQwenImageTask: vi.fn(),
  apimartSubmitImage: vi.fn(),
  extractApimartImageUrls: vi.fn(),
  reapiGetImageTask: vi.fn(),
  extractReapiImageUrls: vi.fn(),
  aicomingHaiyaGetImageTask: vi.fn(),
  extractAicomingImageUrls: vi.fn(),
  miniMaxGetVideoTask: vi.fn(),
  wanGetVideoTask: vi.fn(),
  seedanceGetTask: vi.fn(),
  mediaKitGetTask: vi.fn(),
  saveRemoteFileWithHash: vi.fn(),
  upsertUsageLedgerForGenerationId: vi.fn(),
  upsertUsageLedgerForGeneration: vi.fn(),
  upsertAdminAssetFeedForGenerationId: vi.fn(),
  upsertAdminAssetFeedForRows: vi.fn(),
  createGenerationDisplayAssetPatch: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('@/lib/generation/agent-output-recovery',()=>({readGenerationImageOutputs:mocks.recoveryRead,removeGenerationImageOutputs:mocks.recoveryRemove}));
vi.mock("@/lib/prisma", () => ({
  default: {
    $transaction: mocks.transaction,
    generation: {
      findUnique: mocks.findUnique,
      findFirst: mocks.findFirst,
      updateMany: mocks.updateMany,
      update: mocks.update,
      create: mocks.create,
    },
  },
}));
vi.mock("@/lib/volcengine-mediakit", async (original) => ({ ...await original<typeof import("@/lib/volcengine-mediakit")>(), getMediaKitSubtitleTask: mocks.mediaKitGetTask }));
vi.mock("@/lib/kie", () => ({ kieGetTaskDetail: mocks.kieGetTaskDetail }));
vi.mock("@/lib/bailian-qwen-image", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/bailian-qwen-image")>(),
  bailianGetQwenImageTask: mocks.bailianGetQwenImageTask,
}));
vi.mock("@/lib/work-fisher-image", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/work-fisher-image")>(),
  workFisherGetImageTask: mocks.workFisherGetImageTask,
}));
vi.mock("@/lib/runninghub", () => ({ runningHubGetTask: vi.fn() }));
vi.mock("@/lib/seedance", () => ({ extractSeedanceLastFrameUrl: vi.fn(), seedanceGetTask: mocks.seedanceGetTask }));
vi.mock("@/lib/apimart-image", () => ({
  apimartGetTask: mocks.apimartGetTask,
  apimartSubmitImage: mocks.apimartSubmitImage,
  extractApimartImageUrls: mocks.extractApimartImageUrls,
}));
vi.mock("@/lib/apimart-video", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/apimart-video")>();
  return { extractApimartLastFrameUrl: actual.extractApimartLastFrameUrl, extractApimartVideoUrls: actual.extractApimartVideoUrls };
});
vi.mock("@/lib/reapi-image", () => ({
  reapiGetImageTask: mocks.reapiGetImageTask,
  extractReapiImageUrls: mocks.extractReapiImageUrls,
}));
vi.mock("@/lib/aicoming-image", () => ({
  aicomingHaiyaGetImageTask: mocks.aicomingHaiyaGetImageTask,
  extractAicomingImageUrls: mocks.extractAicomingImageUrls,
}));
vi.mock("@/lib/minimax-video", () => ({ miniMaxGetVideoTask: mocks.miniMaxGetVideoTask }));
vi.mock("@/lib/wan-video", () => ({ wanGetVideoTask: mocks.wanGetVideoTask }));
vi.mock("@/lib/storage", () => ({ saveRemoteFileWithHash: mocks.saveRemoteFileWithHash }));
vi.mock("@/lib/logger", () => ({ Logger: { generation: vi.fn(async () => undefined) } }));
vi.mock("@/lib/error-friendly", () => ({
  formatFriendlyMessageForStorage: vi.fn((value: { message?: string } | string) =>
    typeof value === "string" ? value : value.message || "failed"),
  toFriendlyError: vi.fn((message: string) => ({ message })),
  unknownFriendlyErrorLogMeta: vi.fn(() => null),
}));
vi.mock("@/lib/billing-ledger", () => ({
  upsertUsageLedgerForGenerationId: mocks.upsertUsageLedgerForGenerationId,
  upsertUsageLedgerForGeneration: mocks.upsertUsageLedgerForGeneration,
}));
vi.mock("@/lib/generation-display-assets", () => ({ createGenerationDisplayAssetPatch: mocks.createGenerationDisplayAssetPatch }));
vi.mock("@/lib/admin-asset-feed", () => ({
  upsertAdminAssetFeedForGenerationId: mocks.upsertAdminAssetFeedForGenerationId,
  upsertAdminAssetFeedForRows: mocks.upsertAdminAssetFeedForRows,
}));
vi.mock("@/lib/providers/error-safety", () => ({
  sanitizeProviderErrorFields: vi.fn((value: unknown) => value),
  sanitizeProviderErrorText: vi.fn((message: string) => message)
}));

import {
  classifyFinalizeError,
  finalizeGeneration,
  finalizeRetryDelayMs,
} from "@/lib/generation/finalize";
import { GenerationClaimLostError } from "@/lib/generation/claim-lease";

const generation = {
  id: 41,
  userId: "7",
  authUserId: 7,
  type: "image_edit",
  source: "tool",
  prompt: "two outputs",
  templateData: "{}",
  model: "test-model",
  status: "running",
  localPath: null,
  externalProvider: "kie",
  externalTaskId: "provider-task-41",
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe("finalize retry policy", () => {
  it.each([
    [new Error("read ECONNRESET"), "transient"],
    [new Error("HTTP 429 too many requests"), "transient"],
    [new Error("upstream returned 503"), "transient"],
    [new Error("HTTP 401 unauthorized"), "terminal"],
    [new Error("validation failed with 422"), "terminal"],
  ] as const)("classifies %s as %s", (error, expected) => {
    expect(classifyFinalizeError(error)).toBe(expected);
  });

  it("backs off polling without exceeding thirty seconds", () => {
    expect(finalizeRetryDelayMs(1)).toBe(2_000);
    expect(finalizeRetryDelayMs(2)).toBe(4_000);
    expect(finalizeRetryDelayMs(6)).toBe(30_000);
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function waitFor(predicate: () => boolean) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 0));
  }
  throw new Error("condition was not reached");
}

describe("Generation completion maintenance drain ordering", () => {
  let parentStatus: string;
  let parentLocalPath: string | null;
  let templateData: string;
  let parentUpdatedAt: Date;

  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    parentStatus = "running";
    parentLocalPath = null;
    templateData = "{}";
    parentUpdatedAt = generation.updatedAt;

    mocks.upsertUsageLedgerForGenerationId.mockReset();
    mocks.upsertUsageLedgerForGeneration.mockReset();
    mocks.upsertAdminAssetFeedForGenerationId.mockReset();
    mocks.upsertAdminAssetFeedForRows.mockReset();
    mocks.seedanceGetTask.mockReset();
    mocks.apimartGetTask.mockReset();
    mocks.apimartSubmitImage.mockReset();
    mocks.extractApimartImageUrls.mockReset().mockReturnValue([]);
    mocks.reapiGetImageTask.mockReset();
    mocks.extractReapiImageUrls.mockReset().mockReturnValue([]);
    mocks.aicomingHaiyaGetImageTask.mockReset();
    mocks.extractAicomingImageUrls.mockReset().mockReturnValue([]);
    mocks.miniMaxGetVideoTask.mockReset();
    mocks.wanGetVideoTask.mockReset();
    mocks.createGenerationDisplayAssetPatch.mockReset().mockResolvedValue({});
    mocks.findUnique.mockImplementation(async ({ select }: { select?: { templateData?: boolean } }) =>
      select?.templateData
        ? { templateData, updatedAt: parentUpdatedAt }
        : { ...generation, status: parentStatus, localPath: parentLocalPath, templateData, updatedAt: parentUpdatedAt });
    mocks.findFirst.mockResolvedValue(null);
    mocks.upsertUsageLedgerForGenerationId.mockResolvedValue(undefined);
    mocks.upsertUsageLedgerForGeneration.mockResolvedValue(undefined);
    mocks.upsertAdminAssetFeedForGenerationId.mockResolvedValue(undefined);
    mocks.upsertAdminAssetFeedForRows.mockResolvedValue(undefined);
    const matchesWhere = (where: { status?: unknown; localPath?: unknown; templateData?: unknown; updatedAt?: Date }) => {
      const statusAllowed = where.status === undefined ? true : typeof where.status === "object" && where.status && "in" in where.status
        ? (where.status as { in: string[] }).in.includes(parentStatus)
        : where.status === parentStatus;
      const localPathAllowed = !("localPath" in where) || where.localPath === parentLocalPath;
      const templateAllowed = !("templateData" in where)
        || (typeof where.templateData === "string" && where.templateData === templateData)
        || (!!where.templateData && typeof where.templateData === "object" && "contains" in where.templateData
          && templateData.includes(String((where.templateData as { contains: string }).contains)));
      const revisionAllowed = !("updatedAt" in where) || where.updatedAt?.getTime() === parentUpdatedAt.getTime();
      return statusAllowed && localPathAllowed && templateAllowed && revisionAllowed;
    };
    const applyData = (data: { status?: string; localPath?: string | null; templateData?: string; updatedAt?: Date }) => {
      if (data.status) parentStatus = data.status;
      if ("localPath" in data) parentLocalPath = data.localPath ?? null;
      if (data.templateData) templateData = data.templateData;
      if (data.updatedAt) parentUpdatedAt = data.updatedAt;
    };
    mocks.updateMany.mockImplementation(async ({ where, data }: { where: { status?: unknown; localPath?: unknown; templateData?: unknown; updatedAt?: Date }; data: { status?: string; localPath?: string | null; templateData?: string; updatedAt?: Date } }) => {
      if (!matchesWhere(where)) return { count: 0 };
      applyData(data);
      return { count: 1 };
    });
    mocks.transaction.mockImplementation(async (callback: (tx: any) => Promise<any>) => {
      const startStatus = parentStatus;
      const startLocalPath = parentLocalPath;
      const startTemplateData = templateData;
      const startUpdatedAt = parentUpdatedAt;
      let txStatus = startStatus;
      let txLocalPath = startLocalPath;
      let txTemplateData = startTemplateData;
      let txUpdatedAt = startUpdatedAt;
      const txMatchesWhere = (where: { status?: unknown; localPath?: unknown; templateData?: unknown; updatedAt?: Date }) => {
        const statusAllowed = where.status === undefined ? true : typeof where.status === "object" && where.status && "in" in where.status
          ? (where.status as { in: string[] }).in.includes(txStatus)
          : where.status === txStatus;
        const localPathAllowed = !("localPath" in where) || where.localPath === txLocalPath;
        const templateAllowed = !("templateData" in where)
          || (typeof where.templateData === "string" && where.templateData === txTemplateData)
          || (!!where.templateData && typeof where.templateData === "object" && "contains" in where.templateData
            && txTemplateData.includes(String((where.templateData as { contains: string }).contains)));
        const revisionAllowed = !("updatedAt" in where) || where.updatedAt?.getTime() === txUpdatedAt.getTime();
        return statusAllowed && localPathAllowed && templateAllowed && revisionAllowed;
      };
      const txApplyData = (data: Record<string, any>) => {
        if (data.status) txStatus = data.status;
        if ("localPath" in data) txLocalPath = data.localPath ?? null;
        if (data.templateData) txTemplateData = data.templateData;
        if (data.updatedAt) txUpdatedAt = data.updatedAt;
      };
      try {
        const result = await callback({
          generation: {
            updateMany: async ({ where, data }: { where: any; data: Record<string, any> }) => {
              if (!txMatchesWhere(where)) return { count: 0 };
              txApplyData(data);
              return { count: 1 };
            },
            findUnique: async () => ({ templateData: txTemplateData }),
            findFirst: (input: any) => mocks.findFirst(input),
            create: (input: any) => mocks.create(input),
          },
        });
        if (parentStatus !== startStatus
          || parentLocalPath !== startLocalPath
          || templateData !== startTemplateData
          || parentUpdatedAt.getTime() !== startUpdatedAt.getTime()) {
          throw new GenerationClaimLostError();
        }
        parentStatus = txStatus;
        parentLocalPath = txLocalPath;
        templateData = txTemplateData;
        parentUpdatedAt = txUpdatedAt;
        return result;
      } catch (error) {
        throw error;
      }
    });
    mocks.update.mockImplementation(async ({ data }: { data: { status?: string; localPath?: string; templateData?: string } }) => {
      if (data.status) parentStatus = data.status;
      if (data.localPath) parentLocalPath = data.localPath;
      if (data.templateData) templateData = data.templateData;
      return { id: generation.id };
    });
    mocks.kieGetTaskDetail.mockResolvedValue({
      state: "success",
      resultJson: JSON.stringify({ resultUrls: ["https://provider.test/one.png", "https://provider.test/two.png"] }),
    });
    mocks.saveRemoteFileWithHash
      .mockResolvedValueOnce({ localPath: "/uploads/image_results/one.png", hash: "hash-one" })
      .mockResolvedValueOnce({ localPath: "/uploads/image_results/two.png", hash: "hash-two" });
  });

  it.each([0,1])("recovers all synchronous outputs after item %s fails without querying the generation provider",async failedIndex=>{
    const sources=['https://provider.test/a?signature=secret','data:image/png;base64,Yg==','https://provider.test/c'];
    templateData=JSON.stringify({agentOutputContract:{version:2,receiptId:'r',maxReturned:1},agentOutputObservation:{rawReturned:3,uniqueOutputs:3,savedOutputs:0},agentOutputRecovery:{version:1,key:'private-key',items:sources.map((_,outputIndex)=>({outputIndex,state:'pending'}))},billing:{childBillable:false}});
    mocks.recoveryRead.mockResolvedValue(sources);
    mocks.findUnique.mockImplementation(async({select}:any)=>select?.templateData?{templateData,updatedAt:parentUpdatedAt}:{...generation,externalProvider:'openrouter',externalTaskId:null,status:parentStatus,localPath:parentLocalPath,templateData,updatedAt:parentUpdatedAt});
    mocks.saveRemoteFileWithHash.mockReset().mockImplementation(async(source:string)=>{
      const index=sources.indexOf(source);if(index===failedIndex)throw new Error('temporary download failure');
      return {localPath:'/uploads/'+index+'.png',hash:'hash-'+index};
    });
    await expect(finalizeGeneration(generation.id)).resolves.toBe('pending');
    expect(mocks.saveRemoteFileWithHash).toHaveBeenCalledTimes(3);
    const durable=JSON.parse(templateData);
    expect(durable.savedOutputs).toHaveLength(2);
    expect(durable.agentOutputRecovery.items.map((item:any)=>item.state)).toEqual(sources.map((_,index)=>index===failedIndex?'failed':'saved'));
    expect(templateData).not.toContain('signature=secret');expect(templateData).not.toContain('data:image');
    // A new finalizer invocation has only the persistent row and private snapshot.
    mocks.saveRemoteFileWithHash.mockClear().mockImplementation(async()=>({localPath:'/uploads/'+failedIndex+'.png',hash:'hash-'+failedIndex}));
    mocks.create.mockResolvedValueOnce({id:84}).mockResolvedValueOnce({id:85});
    await expect(finalizeGeneration(generation.id)).resolves.toBe('done');
    expect(mocks.saveRemoteFileWithHash).toHaveBeenCalledTimes(1);
    expect(mocks.saveRemoteFileWithHash.mock.calls[0][0]).toBe(sources[failedIndex]);
    expect(JSON.parse(templateData)).toMatchObject({agentOutputObservation:{rawReturned:3,uniqueOutputs:3,savedOutputs:3},agentOutputRecovery:{items:[{state:'saved'},{state:'saved'},{state:'saved'}]}});
    expect(mocks.kieGetTaskDetail).not.toHaveBeenCalled();expect(mocks.recoveryRemove).toHaveBeenCalledWith(generation.id,'private-key');
    await expect(finalizeGeneration(generation.id)).resolves.toBe('skipped');expect(mocks.saveRemoteFileWithHash).toHaveBeenCalledTimes(1);
  });

  it("records v2 raw image returns before content deduplication and retains every distinct output", async () => {
    templateData = JSON.stringify({agentOutputContract:{version:2,receiptId:"r",maxReturned:1}});
    mocks.kieGetTaskDetail.mockResolvedValue({state:"success",resultJson:JSON.stringify({resultUrls:["https://provider.test/a.png","https://provider.test/a-copy.png","https://provider.test/b.png"]})});
    mocks.saveRemoteFileWithHash.mockReset().mockResolvedValueOnce({localPath:"/uploads/a.png",hash:"a"}).mockResolvedValueOnce({localPath:"/uploads/a.png",hash:"a"}).mockResolvedValueOnce({localPath:"/uploads/b.png",hash:"b"});
    mocks.create.mockResolvedValue({id:84});
    await expect(finalizeGeneration(generation.id)).resolves.toBe("done");
    expect(JSON.parse(templateData)).toMatchObject({agentOutputObservation:{rawReturned:3,uniqueOutputs:2,savedOutputs:2},savedOutputs:[{localPath:"/uploads/a.png"},{localPath:"/uploads/b.png"}]});
    await expect(finalizeGeneration(generation.id)).resolves.toBe("skipped");
    expect(mocks.saveRemoteFileWithHash).toHaveBeenCalledTimes(3);
  });

  it("retains v2 partial saved-output counts when a later download fails", async () => {
    templateData = JSON.stringify({agentOutputContract:{version:2,receiptId:"r",maxReturned:1}});
    mocks.saveRemoteFileWithHash.mockReset().mockResolvedValueOnce({localPath:"/uploads/a.png",hash:"a"}).mockRejectedValueOnce(new Error("network storage unavailable"));
    await finalizeGeneration(generation.id);
    expect(JSON.parse(templateData)).toMatchObject({agentOutputObservation:{rawReturned:2,uniqueOutputs:1,savedOutputs:1},savedOutputs:[{localPath:"/uploads/a.png"}]});
  });

  it("records the finalize attempt while the provider is still running", async () => {
    mocks.kieGetTaskDetail.mockResolvedValue({ state: "processing" });

    await expect(finalizeGeneration(generation.id)).resolves.toBe("pending");

    expect(templateData).toContain('"phase":"generating"');
    expect(templateData).toContain('"attempt":1');
  });

  it("stores finalized canvas image outputs in the canvas image result folder", async () => {
    generation.source = "canvas";
    mocks.create.mockResolvedValue({ id: 84 });
    try {
      await expect(finalizeGeneration(generation.id)).resolves.toBe("done");
      expect(mocks.saveRemoteFileWithHash.mock.calls.map((call) => call[1])).toEqual([
        "canvas_image_results",
        "canvas_image_results",
      ]);
    } finally {
      generation.source = "tool";
    }
  });

  it("stores finalized canvas video outputs in the canvas video result folder", async () => {
    const originalType = generation.type;
    generation.source = "canvas";
    generation.type = "video_gen";
    mocks.kieGetTaskDetail.mockResolvedValue({
      state: "success",
      resultJson: JSON.stringify({ resultUrls: ["https://provider.test/one.mp4"] }),
    });
    mocks.saveRemoteFileWithHash.mockReset().mockResolvedValue({
      localPath: "/uploads/canvas_video_results/one.mp4",
      hash: "hash-video",
    });
    try {
      await expect(finalizeGeneration(generation.id)).resolves.toBe("done");
      expect(mocks.saveRemoteFileWithHash).toHaveBeenCalledWith(
        "https://provider.test/one.mp4",
        "canvas_video_results",
        false,
        { providerId: "kie" },
      );
    } finally {
      generation.source = "tool";
      generation.type = originalType;
    }
  });

  it.each(["processing", "completed", "failed", "network"])("resumes persisted MediaKit tasks: %s", async state => {
    const original = { ...generation };
    Object.assign(generation, { type: "video_gen", source: "canvas", externalProvider: "volcengine-mediakit", model: "erase-video-subtitle-pro-v5" });
    if (state === "network") mocks.mediaKitGetTask.mockRejectedValueOnce(new Error("ECONNRESET"));
    else mocks.mediaKitGetTask.mockResolvedValueOnce({ status: state, result: { video_url: "https://provider.test/one.mp4", duration: 15.5 }, error: { message: "invalid video" } });
    mocks.saveRemoteFileWithHash.mockReset().mockResolvedValue({ localPath: "/uploads/canvas_video_results/one.mp4", hash: "hash-video" });
    try {
      await expect(finalizeGeneration(generation.id)).resolves.toBe(state === "completed" ? "done" : state === "failed" ? "failed" : "pending");
      expect(mocks.mediaKitGetTask).toHaveBeenCalledWith(generation.externalTaskId);
      if (state === "completed") {
        expect(parentStatus).toBe("success");
        expect(JSON.parse(templateData)).toMatchObject({ duration: 15.5, providerUsage: { duration: 15.5 } });
        expect(mocks.saveRemoteFileWithHash).toHaveBeenCalledWith("https://provider.test/one.mp4", "canvas_video_results", false, { providerId: "volcengine-mediakit" });
        await expect(finalizeGeneration(generation.id)).resolves.toBe("skipped");
        expect(mocks.saveRemoteFileWithHash).toHaveBeenCalledTimes(1);
      } else expect(mocks.saveRemoteFileWithHash).not.toHaveBeenCalled();
    } finally { Object.assign(generation, original); }
  });

  it("keeps the claimed parent active until the extra output row and metadata are durable", async () => {
    const extraCreate = deferred<{ id: number }>();
    mocks.create.mockReturnValue(extraCreate.promise);

    const completion = finalizeGeneration(generation.id);
    await waitFor(() => mocks.create.mock.calls.length === 1);

    expect(parentStatus).toBe("processing");
    expect(parentLocalPath).toBeNull();
    expect(templateData).not.toContain('"generationId":84');

    extraCreate.resolve({ id: 84 });
    await expect(completion).resolves.toBe("done");
    expect(parentStatus).toBe("success");
    expect(parentLocalPath).toBe("/uploads/image_results/one.png");
    expect(templateData).toContain('"generationId":84');
  });

  it("does not expose a successful parent when the extra output row cannot be created", async () => {
    mocks.create.mockRejectedValue(new Error("permission denied creating extra row"));

    await expect(finalizeGeneration(generation.id)).resolves.toBe("pending");

    expect(parentStatus).toBe("running");
    expect(parentLocalPath).toBeNull();
    expect(templateData).toContain('"savedOutputs"');
    expect(templateData).toContain("/uploads/image_results/two.png");
    expect(mocks.update).not.toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "success" }),
    }));
  });

  it("keeps the durable output successful when terminal projection sync fails", async () => {
    let failReleaseRead = false;
    mocks.create.mockResolvedValue({ id: 84 });
    mocks.findUnique.mockImplementation(async ({ select }: { select?: { templateData?: boolean } }) => {
      if (select?.templateData && failReleaseRead) throw new Error("temporary metadata read failure");
      return select?.templateData
        ? { templateData, updatedAt: parentUpdatedAt }
        : { ...generation, status: parentStatus, localPath: parentLocalPath, templateData, updatedAt: parentUpdatedAt };
    });
    mocks.upsertUsageLedgerForGeneration.mockImplementation(async (row: { id: number; status: string }) => {
      if (row.id === generation.id && row.status === "success") {
        failReleaseRead = true;
        throw new Error("temporary parent terminal derived-write failure");
      }
    });

    await expect(finalizeGeneration(generation.id)).resolves.toBe("done");

    expect(parentStatus).toBe("success");
    expect(parentLocalPath).toBe("/uploads/image_results/one.png");
    expect(templateData).toContain('"generationId":84');
    expect(mocks.updateMany).toHaveBeenCalled();
  });

  it("marks the parent successful without waiting for child projections", async () => {
    const childUsage = deferred<undefined>();
    const childFeed = deferred<undefined>();
    mocks.create.mockResolvedValue({ id: 84 });
    mocks.upsertUsageLedgerForGeneration.mockImplementation((row: { id: number }) => row.id === 84 ? childUsage.promise : Promise.resolve(undefined));
    mocks.upsertAdminAssetFeedForRows.mockImplementation((rows: Array<{ id: number }>) => rows[0]?.id === 84 ? childFeed.promise : Promise.resolve(undefined));

    const completion = finalizeGeneration(generation.id);
    await waitFor(() => mocks.upsertUsageLedgerForGeneration.mock.calls.some(([row]) => row.id === 84));

    await expect(completion).resolves.toBe("done");
    expect(parentStatus).toBe("success");
    expect(parentLocalPath).toBe("/uploads/image_results/one.png");

    childUsage.resolve(undefined);
    childFeed.resolve(undefined);
  });

  it("keeps the successful child and parent when a child projection fails", async () => {
    mocks.create.mockResolvedValue({ id: 84 });
    mocks.findFirst.mockResolvedValue(null);
    mocks.upsertUsageLedgerForGeneration.mockRejectedValueOnce(new Error("temporary usage ledger failure"));

    await expect(finalizeGeneration(generation.id)).resolves.toBe("done");
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.upsertUsageLedgerForGeneration.mock.calls.filter(([row]) => row.id === 84)).toHaveLength(1);
    expect(parentStatus).toBe("success");
    expect(parentLocalPath).toBe("/uploads/image_results/one.png");
    expect(templateData).toContain('"generationId":84');
  });

  it("does not reopen the parent recovery path when a child projection fails", async () => {
    mocks.create.mockResolvedValue({ id: 84 });
    mocks.upsertUsageLedgerForGeneration.mockRejectedValueOnce(new Error("temporary child ledger failure"));

    await expect(finalizeGeneration(generation.id)).resolves.toBe("done");
    expect(parentStatus).toBe("success");
    expect(mocks.upsertAdminAssetFeedForGenerationId).not.toHaveBeenCalledWith(generation.id);
  });

  it("commits the successful parent before terminal projections settle", async () => {
    const parentUsage = deferred<undefined>();
    const parentFeed = deferred<undefined>();
    mocks.create.mockResolvedValue({ id: 84 });
    mocks.upsertUsageLedgerForGenerationId.mockImplementation((id: number) => id === generation.id ? parentUsage.promise : Promise.resolve(undefined));
    mocks.upsertAdminAssetFeedForGenerationId.mockImplementation((id: number) => id === generation.id ? parentFeed.promise : Promise.resolve(undefined));
    mocks.upsertUsageLedgerForGeneration.mockImplementation((row: { id: number }) =>
      row.id === generation.id ? parentUsage.promise : Promise.resolve(undefined));
    mocks.upsertAdminAssetFeedForRows.mockImplementation((rows: Array<{ id: number }>) =>
      rows[0]?.id === generation.id ? parentFeed.promise : Promise.resolve(undefined));

    const completion = finalizeGeneration(generation.id);
    await waitFor(() =>
      mocks.upsertUsageLedgerForGenerationId.mock.calls.some(([id]) => id === generation.id)
      || mocks.upsertUsageLedgerForGeneration.mock.calls.length > 0);

    expect(parentStatus).toBe("success");
    expect(parentLocalPath).toBe("/uploads/image_results/one.png");

    parentUsage.resolve(undefined);
    parentFeed.resolve(undefined);
    await expect(completion).resolves.toBe("done");
    expect(parentStatus).toBe("success");
  });

  it("commits the failed parent before failure projections settle", async () => {
    const failedUsage = deferred<undefined>();
    const failedFeed = deferred<undefined>();
    mocks.kieGetTaskDetail.mockResolvedValue({ state: "fail", failMsg: "provider failed" });
    mocks.upsertUsageLedgerForGenerationId.mockImplementation(() => failedUsage.promise);
    mocks.upsertAdminAssetFeedForGenerationId.mockImplementation(() => failedFeed.promise);
    mocks.upsertUsageLedgerForGeneration.mockImplementation(() => failedUsage.promise);
    mocks.upsertAdminAssetFeedForRows.mockImplementation(() => failedFeed.promise);

    const completion = finalizeGeneration(generation.id);
    await waitFor(() =>
      mocks.upsertUsageLedgerForGeneration.mock.calls.length > 0);

    expect(parentStatus).toBe("failed");
    expect(parentLocalPath).toBeNull();

    failedUsage.resolve(undefined);
    failedFeed.resolve(undefined);
    await expect(completion).resolves.toBe("failed");
    expect(parentStatus).toBe("failed");
  });

  it("does not reopen a failed parent when failure projection sync fails", async () => {
    mocks.kieGetTaskDetail.mockResolvedValue({ state: "fail", failMsg: "provider failed" });
    mocks.upsertUsageLedgerForGeneration.mockRejectedValueOnce(new Error("temporary failed-ledger write error"));

    await expect(finalizeGeneration(generation.id)).resolves.toBe("failed");
    expect(parentStatus).toBe("failed");
    expect(parentLocalPath).toBeNull();

    await expect(finalizeGeneration(generation.id)).resolves.toBe("skipped");
    expect(parentStatus).toBe("failed");
    expect(mocks.upsertUsageLedgerForGeneration).toHaveBeenCalledTimes(1);
    expect(mocks.upsertAdminAssetFeedForRows).toHaveBeenCalledTimes(1);
  });

  it("preserves the first durable output when a later save ends in a terminal permission error", async () => {
    mocks.saveRemoteFileWithHash.mockReset()
      .mockResolvedValueOnce({ localPath: "/uploads/image_results/one.png", hash: "hash-one" })
      .mockRejectedValueOnce(new Error("403 forbidden while saving second output"));

    await expect(finalizeGeneration(generation.id)).resolves.toBe("failed");

    expect(parentStatus).toBe("failed");
    expect(templateData).toContain('"savedOutputs"');
    expect(templateData).toContain("/uploads/image_results/one.png");
  });

  it("fails an expired task instead of retrying final persistence forever", async () => {
    const oldCreatedAt = new Date(Date.now() - 16 * 60 * 1000);
    mocks.create.mockRejectedValue(new Error("database unavailable creating extra output"));
    mocks.findUnique.mockImplementation(async ({ select }: { select?: { templateData?: boolean } }) =>
      select?.templateData
        ? { templateData, updatedAt: parentUpdatedAt }
        : {
            ...generation,
            createdAt: oldCreatedAt,
            status: parentStatus,
            localPath: parentLocalPath,
            templateData,
            updatedAt: parentUpdatedAt,
          });

    await expect(finalizeGeneration(generation.id)).resolves.toBe("failed");

    expect(parentStatus).toBe("failed");
    expect(templateData).toContain('"phase":"failed"');
    expect(templateData).toContain('"savedOutputs"');
  });

  it("releases the claim when the full claimed row cannot be re-read", async () => {
    let fullReadCount = 0;
    mocks.findUnique.mockImplementation(async ({ select }: { select?: { templateData?: boolean } }) => {
      if (!select && ++fullReadCount === 2) throw new Error("temporary claimed-row read failure");
      return select?.templateData
        ? { templateData, updatedAt: parentUpdatedAt }
        : { ...generation, status: parentStatus, localPath: parentLocalPath, templateData, updatedAt: parentUpdatedAt };
    });
    mocks.kieGetTaskDetail.mockResolvedValue({ state: "fail", failMsg: "provider failed" });

    await expect(finalizeGeneration(generation.id)).resolves.toBe("pending");

    expect(fullReadCount).toBe(2);
    expect(parentStatus).toBe("running");
    expect(parentLocalPath).toBeNull();
  });

  it("does not steal an active processing claim merely because createdAt exceeded the timeout", async () => {
    parentStatus = "processing";
    const oldCreatedAt = new Date(Date.now() - 16 * 60 * 1000);
    mocks.findUnique.mockImplementation(async ({ select }: { select?: { templateData?: boolean } }) =>
      select?.templateData
        ? { templateData, updatedAt: parentUpdatedAt }
        : { ...generation, createdAt: oldCreatedAt, status: parentStatus, localPath: parentLocalPath, templateData, updatedAt: parentUpdatedAt });

    await expect(finalizeGeneration(generation.id)).resolves.toBe("skipped");

    expect(parentStatus).toBe("processing");
    expect(mocks.upsertUsageLedgerForGeneration).not.toHaveBeenCalled();
  });

  it("does not poll or claim an in-flight synchronous Haiya 2.5 request", async () => {
    mocks.findUnique.mockResolvedValue({ ...generation, model: "gpt-image-2.5-aicoming-haiya", externalProvider: "aicoming-haiya", externalTaskId: null, createdAt: new Date(Date.now() - 10 * 60 * 1000), updatedAt: parentUpdatedAt });
    await expect(finalizeGeneration(generation.id)).resolves.toBe("skipped");
    expect(mocks.aicomingHaiyaGetImageTask).not.toHaveBeenCalled();
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("fails an old orphan that never received an upstream task id", async () => {
    const oldCreatedAt = new Date(Date.now() - 16 * 60 * 1000);
    mocks.findUnique.mockImplementation(async ({ select }: { select?: { templateData?: boolean } }) =>
      select?.templateData
        ? { templateData, updatedAt: parentUpdatedAt }
        : {
            ...generation,
            externalTaskId: null,
            createdAt: oldCreatedAt,
            status: parentStatus,
            localPath: parentLocalPath,
            templateData,
            updatedAt: parentUpdatedAt,
          });

    await expect(finalizeGeneration(generation.id)).resolves.toBe("failed");

    expect(parentStatus).toBe("failed");
    expect(templateData).toContain('"providerStatus":"missing_task_id"');
    expect(mocks.kieGetTaskDetail).not.toHaveBeenCalled();
  });

  it("fails an old synchronous Volcengine image orphan", async () => {
    const oldCreatedAt = new Date(Date.now() - 16 * 60 * 1000);
    mocks.findUnique.mockImplementation(async ({ select }: { select?: { templateData?: boolean } }) =>
      select?.templateData
        ? { templateData, updatedAt: parentUpdatedAt }
        : {
            ...generation,
            externalProvider: "volcengine",
            externalTaskId: "local-generation-41",
            createdAt: oldCreatedAt,
            status: parentStatus,
            localPath: parentLocalPath,
            templateData,
            updatedAt: parentUpdatedAt,
          });

    await expect(finalizeGeneration(generation.id)).resolves.toBe("failed");

    expect(parentStatus).toBe("failed");
    expect(templateData).toContain('"providerStatus":"local_finalize_timeout"');
    expect(mocks.seedanceGetTask).not.toHaveBeenCalled();
  });

  it("fails an old synchronous provider orphan without a polling adapter", async () => {
    const oldCreatedAt = new Date(Date.now() - 16 * 60 * 1000);
    mocks.findUnique.mockImplementation(async ({ select }: { select?: { templateData?: boolean } }) =>
      select?.templateData
        ? { templateData, updatedAt: parentUpdatedAt }
        : {
            ...generation,
            externalProvider: "easyrouter",
            externalTaskId: "local-generation-41",
            createdAt: oldCreatedAt,
            status: parentStatus,
            localPath: parentLocalPath,
            templateData,
            updatedAt: parentUpdatedAt,
          });

    await expect(finalizeGeneration(generation.id)).resolves.toBe("failed");

    expect(parentStatus).toBe("failed");
    expect(templateData).toContain('"providerStatus":"unsupported_provider_timeout"');
    expect(mocks.kieGetTaskDetail).not.toHaveBeenCalled();
  });

  it("finishes a saved output even when the provider-generation timeout has elapsed", async () => {
    const oldCreatedAt = new Date(Date.now() - 16 * 60 * 1000);
    templateData = JSON.stringify({
      phase: "saving",
      remotePreviewUrls: ["https://provider.test/one.png"],
      savedOutputs: [{
        outputIndex: 0,
        remoteUrl: "https://provider.test/one.png",
        localPath: "/uploads/image_results/one.png",
        hash: "hash-one",
      }],
    });
    mocks.findUnique.mockImplementation(async ({ select }: { select?: { templateData?: boolean } }) =>
      select?.templateData
        ? { templateData, updatedAt: parentUpdatedAt }
        : { ...generation, createdAt: oldCreatedAt, status: parentStatus, localPath: parentLocalPath, templateData, updatedAt: parentUpdatedAt });
    mocks.kieGetTaskDetail.mockResolvedValue({
      state: "success",
      resultJson: JSON.stringify({ resultUrls: ["https://provider.test/one.png"] }),
    });

    await expect(finalizeGeneration(generation.id)).resolves.toBe("done");

    expect(parentStatus).toBe("success");
    expect(parentLocalPath).toBe("/uploads/image_results/one.png");
    expect(mocks.saveRemoteFileWithHash).not.toHaveBeenCalled();
  });

  it("checks Seedance before timing out and finalizes an already completed video", async () => {
    const oldCreatedAt = new Date(Date.now() - 31 * 60 * 1000);
    const videoGeneration = {
      ...generation,
      type: "video_gen",
      model: "doubao-seedance-2-0-260128",
      externalProvider: "volcengine",
      externalTaskId: "seedance-task-41",
      createdAt: oldCreatedAt,
    };
    mocks.findUnique.mockImplementation(async ({ select }: { select?: { templateData?: boolean } }) =>
      select?.templateData
        ? { templateData, updatedAt: parentUpdatedAt }
        : { ...videoGeneration, status: parentStatus, localPath: parentLocalPath, templateData, updatedAt: parentUpdatedAt });
    mocks.seedanceGetTask.mockResolvedValue({
      status: "succeeded",
      content: { video_url: "https://provider.test/video.mp4" },
    });
    mocks.saveRemoteFileWithHash.mockReset().mockResolvedValue({
      localPath: "/uploads/video_results/video.mp4",
      hash: "hash-video",
    });

    await expect(finalizeGeneration(generation.id)).resolves.toBe("done");

    expect(mocks.seedanceGetTask).toHaveBeenCalledWith("seedance-task-41");
    expect(parentStatus).toBe("success");
    expect(parentLocalPath).toBe("/uploads/video_results/video.mp4");
  });

  it("keeps polling when Seedance still reports running instead of failing on an old provider timestamp", async () => {
    const createdAt = new Date(Date.now() - 21 * 60 * 1000);
    const videoGeneration = {
      ...generation,
      type: "video_gen",
      model: "doubao-seedance-2-0-260128",
      externalProvider: "volcengine",
      externalTaskId: "seedance-task-41",
      createdAt,
    };
    mocks.findUnique.mockImplementation(async ({ select }: { select?: { templateData?: boolean } }) =>
      select?.templateData
        ? { templateData, updatedAt: parentUpdatedAt }
        : { ...videoGeneration, status: parentStatus, localPath: parentLocalPath, templateData, updatedAt: parentUpdatedAt });
    mocks.seedanceGetTask.mockResolvedValue({
      status: "running",
      updated_at: Math.floor(createdAt.getTime() / 1000),
    });

    await expect(finalizeGeneration(generation.id)).resolves.toBe("pending");

    expect(mocks.seedanceGetTask).toHaveBeenCalledWith("seedance-task-41");
    expect(parentStatus).toBe("running");
    expect(parentLocalPath).toBeNull();
  });

  it.each(["completed", "processing", "failed", "cancelled"])("finalizes APIMart Seedance 2.5 %s with nested token usage", async (status) => {
    mocks.apimartGetTask.mockResolvedValue({ data: { status, usage: { completion_tokens: 100000 }, cost: 0.49, credits_cost: 4.9, actual_time: 80, result: { videos: [{ url: ["https://provider.test/am25.mp4"] }] }, error: status === "failed" ? { message: "generation failed" } : undefined } });
    mocks.saveRemoteFileWithHash.mockReset().mockResolvedValue({ localPath: "/uploads/video_results/am25.mp4", hash: "hash-am25" });
    mocks.findUnique.mockImplementation(async ({ select }: { select?: { templateData?: boolean } }) => select?.templateData
      ? { templateData, updatedAt: parentUpdatedAt }
      : { ...generation, type: "video_gen", model: "seedance-2.5-apimart", externalProvider: "apimart", externalTaskId: "am25-task", status: parentStatus, localPath: parentLocalPath, templateData, updatedAt: parentUpdatedAt });
    await expect(finalizeGeneration(generation.id)).resolves.toBe(status === "completed" ? "done" : status === "processing" ? "pending" : "failed");
    expect(mocks.apimartGetTask).toHaveBeenCalledWith("am25-task");
    if (status === "completed") {
      expect(parentStatus).toBe("success");
      expect(parentLocalPath).toBe("/uploads/video_results/am25.mp4");
      expect(JSON.parse(templateData).providerUsage).toMatchObject({ usage: { completion_tokens: 100000 }, cost: 0.49, credits_cost: 4.9, actual_time: 80 });
      expect(mocks.saveRemoteFileWithHash).toHaveBeenCalledWith("https://provider.test/am25.mp4", expect.any(String), false, { providerId: "apimart" });
    } else expect(mocks.saveRemoteFileWithHash).not.toHaveBeenCalled();
  });

  it.each([true, false])("allows delayed APIMart 2.5 usage a bounded grace period (arrives: %s)", async (arrives) => {
    const completed = { data: { status: "completed", result: { videos: [{ url: ["https://provider.test/am25.mp4"] }] } } };
    mocks.apimartGetTask.mockResolvedValue(completed);
    mocks.saveRemoteFileWithHash.mockReset().mockResolvedValue({ localPath: "/uploads/video_results/am25.mp4", hash: "hash-am25" });
    mocks.findUnique.mockImplementation(async ({ select }: { select?: { templateData?: boolean } }) => select?.templateData
      ? { templateData, updatedAt: parentUpdatedAt }
      : { ...generation, type: "video_gen", model: "seedance-2.5-apimart", externalProvider: "apimart", externalTaskId: "am25-task", status: parentStatus, localPath: parentLocalPath, templateData, updatedAt: parentUpdatedAt });
    await expect(finalizeGeneration(generation.id)).resolves.toBe("pending");
    expect(mocks.saveRemoteFileWithHash).not.toHaveBeenCalled();
    if (arrives) mocks.apimartGetTask.mockResolvedValue({ data: { ...completed.data, usage: { completion_tokens: 100000 } } });
    else {
      await expect(finalizeGeneration(generation.id)).resolves.toBe("pending");
      await expect(finalizeGeneration(generation.id)).resolves.toBe("pending");
    }
    await expect(finalizeGeneration(generation.id)).resolves.toBe("done");
    expect(JSON.parse(templateData).providerUsage.usage).toEqual(arrives ? { completion_tokens: 100000 } : null);
  });

  it("fails after a bounded grace period when APIMart completes without outputs", async () => {
    mocks.apimartGetTask.mockResolvedValue({ data: { status: "completed" } });
    mocks.findUnique.mockImplementation(async ({ select }: { select?: { templateData?: boolean } }) =>
      select?.templateData
        ? { templateData, updatedAt: parentUpdatedAt }
        : {
            ...generation,
            externalProvider: "apimart",
            status: parentStatus,
            localPath: parentLocalPath,
            templateData,
            updatedAt: parentUpdatedAt,
          });

    await expect(finalizeGeneration(generation.id)).resolves.toBe("pending");
    await expect(finalizeGeneration(generation.id)).resolves.toBe("pending");
    await expect(finalizeGeneration(generation.id)).resolves.toBe("failed");

    expect(parentStatus).toBe("failed");
    expect(templateData).toContain('"phase":"failed"');
  });

  it.each(["gpt-image-2-apimart", "gpt-image-2.6-apimart"])("retries %s polling with the same upstream task id and saves usage", async (model) => {
    const usage = { input_tokens_details: { text_tokens: 12, image_tokens: 0 }, output_tokens_details: { image_tokens: 300 } };
    mocks.apimartGetTask
      .mockRejectedValueOnce(new Error("read ECONNRESET"))
      .mockResolvedValueOnce({ data: { status: "completed", usage } });
    mocks.extractApimartImageUrls.mockReturnValue(["https://provider.test/apimart.png"]);
    mocks.saveRemoteFileWithHash.mockReset().mockResolvedValue({
      localPath: "/uploads/image_results/apimart.png",
      hash: "hash-apimart",
    });
    mocks.findUnique.mockImplementation(async ({ select }: { select?: { templateData?: boolean } }) =>
      select?.templateData
        ? { templateData, updatedAt: parentUpdatedAt }
        : {
            ...generation,
            model,
            externalProvider: "apimart",
            externalTaskId: "apimart-task-41",
            status: parentStatus,
            localPath: parentLocalPath,
            templateData,
            updatedAt: parentUpdatedAt,
          });

    await expect(finalizeGeneration(generation.id)).resolves.toBe("pending");
    expect(parentStatus).toBe("running");
    expect(templateData).toContain('"attempt":1');

    await expect(finalizeGeneration(generation.id)).resolves.toBe("done");

    expect(mocks.apimartGetTask.mock.calls).toEqual([
      ["apimart-task-41"],
      ["apimart-task-41"],
    ]);
    expect(mocks.apimartSubmitImage).not.toHaveBeenCalled();
    expect(parentStatus).toBe("success");
    expect(parentLocalPath).toBe("/uploads/image_results/apimart.png");
    expect(JSON.parse(templateData).providerUsage.usage).toEqual(usage);
  });

  it("recovers a submitted video after a polling outage exceeds thirty minutes and settles only once", async () => {
    const createdAt = new Date(Date.now() - 31 * 60 * 1000);
    mocks.findUnique.mockImplementation(async ({ select }: { select?: { templateData?: boolean } }) =>
      select?.templateData
        ? { templateData, updatedAt: parentUpdatedAt }
        : { ...generation, type: "video_gen", model: "seedance-2.5-apimart", externalProvider: "apimart", externalTaskId: "am25-task", createdAt, status: parentStatus, localPath: parentLocalPath, templateData, updatedAt: parentUpdatedAt });
    mocks.apimartGetTask
      .mockRejectedValueOnce(new Error("Provider request failed (ECONNRESET)"))
      .mockResolvedValue({ data: { status: "completed", usage: { completion_tokens: 100000 }, result: { videos: [{ url: ["https://provider.test/am25.mp4"] }] } } });
    mocks.saveRemoteFileWithHash.mockReset().mockResolvedValue({ localPath: "/uploads/video_results/am25.mp4", hash: "hash-am25" });

    await expect(finalizeGeneration(generation.id)).resolves.toBe("pending");
    expect(parentStatus).toBe("running");
    expect(JSON.parse(templateData).finalize.lastError).toContain("ECONNRESET");
    expect(mocks.upsertUsageLedgerForGeneration).not.toHaveBeenCalled();

    await expect(finalizeGeneration(generation.id)).resolves.toBe("done");
    await expect(finalizeGeneration(generation.id)).resolves.toBe("skipped");
    expect(parentStatus).toBe("success");
    expect(parentLocalPath).toBe("/uploads/video_results/am25.mp4");
    expect(mocks.apimartGetTask.mock.calls).toEqual([["am25-task"], ["am25-task"]]);
    expect(mocks.upsertUsageLedgerForGeneration).toHaveBeenCalledTimes(1);
    expect(mocks.apimartSubmitImage).not.toHaveBeenCalled();
  });

  it("retries an APIMart result download timeout without duplicating the output", async () => {
    const timeout = Object.assign(new Error("download ETIMEDOUT"), { code: "ETIMEDOUT" });
    mocks.apimartGetTask.mockResolvedValue({ data: { status: "completed" } });
    mocks.extractApimartImageUrls.mockReturnValue(["https://provider.test/apimart.png"]);
    mocks.saveRemoteFileWithHash
      .mockReset()
      .mockRejectedValueOnce(timeout)
      .mockResolvedValueOnce({
        localPath: "/uploads/image_results/apimart.png",
        hash: "hash-apimart",
      });
    mocks.findUnique.mockImplementation(async ({ select }: { select?: { templateData?: boolean } }) =>
      select?.templateData
        ? { templateData, updatedAt: parentUpdatedAt }
        : {
            ...generation,
            externalProvider: "apimart",
            externalTaskId: "apimart-task-41",
            status: parentStatus,
            localPath: parentLocalPath,
            templateData,
            updatedAt: parentUpdatedAt,
          });

    await expect(finalizeGeneration(generation.id)).resolves.toBe("pending");
    await expect(finalizeGeneration(generation.id)).resolves.toBe("done");

    expect(mocks.apimartGetTask.mock.calls).toEqual([
      ["apimart-task-41"],
      ["apimart-task-41"],
    ]);
    expect(mocks.saveRemoteFileWithHash).toHaveBeenCalledTimes(2);
    expect(mocks.apimartSubmitImage).not.toHaveBeenCalled();
    expect(parentStatus).toBe("success");
    expect(JSON.parse(templateData).savedOutputs).toHaveLength(1);
  });

  it.each(["SUCCEEDED", "FAILED", "RUNNING", "EMPTY"])("finalizes Qwen 3 %s without treating it as Wan video", async (status) => {
    mocks.bailianGetQwenImageTask.mockResolvedValue({ output: { task_status: status === "EMPTY" ? "SUCCEEDED" : status, message: "generation failed", choices: status === "EMPTY" ? [] : [{ message: { content: [{ image: "https://provider.test/qwen3.png" }] } }] }, usage: { output_image_count: 1, output_image_type: "qima_output_2k" } });
    mocks.saveRemoteFileWithHash.mockReset().mockResolvedValue({ localPath: "/uploads/image_results/qwen3.png", hash: "hash-qwen3" });
    mocks.findUnique.mockImplementation(async ({ select }: { select?: { templateData?: boolean } }) => select?.templateData
      ? { templateData, updatedAt: parentUpdatedAt }
      : { ...generation, model: "qwen-image-3.0", externalProvider: "bailian", externalTaskId: "qwen3-task", status: parentStatus, localPath: parentLocalPath, templateData, updatedAt: parentUpdatedAt });
    await expect(finalizeGeneration(generation.id)).resolves.toBe(status === "SUCCEEDED" ? "done" : status === "RUNNING" ? "pending" : "failed");
    expect(mocks.bailianGetQwenImageTask).toHaveBeenCalledWith("qwen3-task");
    expect(mocks.wanGetVideoTask).not.toHaveBeenCalled();
    if (status === "SUCCEEDED") {
      expect(mocks.saveRemoteFileWithHash).toHaveBeenCalledWith("https://provider.test/qwen3.png", expect.any(String), false, { providerId: "bailian" });
      expect(parentStatus).toBe("success");
      expect(parentLocalPath).toBe("/uploads/image_results/qwen3.png");
      expect(JSON.parse(templateData).providerUsage).toEqual({ output_image_count: 1, output_image_type: "qima_output_2k" });
    } else expect(mocks.saveRemoteFileWithHash).not.toHaveBeenCalled();
  });

  it.each(["SUCCESS", "FAILURE", "IN_PROGRESS"])("finalizes FisherAI %s using durable storage and provider egress", async (status) => {
    mocks.workFisherGetImageTask.mockResolvedValue({ code: "success", data: { status, result_url: "https://provider.test/qwen.png", fail_reason: "generation failed", usage: { amount: 0.23, currency: "CNY" } } });
    mocks.saveRemoteFileWithHash.mockReset().mockResolvedValue({ localPath: "/uploads/image_results/qwen.png", hash: "hash-qwen" });
    mocks.findUnique.mockImplementation(async ({ select }: { select?: { templateData?: boolean } }) => select?.templateData
      ? { templateData, updatedAt: parentUpdatedAt }
      : { ...generation, model: "qwen-image-global-2.1", externalProvider: "work-fisher", externalTaskId: "fisher-task-41", status: parentStatus, localPath: parentLocalPath, templateData, updatedAt: parentUpdatedAt });
    await expect(finalizeGeneration(generation.id)).resolves.toBe(status === "SUCCESS" ? "done" : status === "FAILURE" ? "failed" : "pending");
    expect(mocks.workFisherGetImageTask).toHaveBeenCalledWith("fisher-task-41");
    if (status === "SUCCESS") {
      expect(mocks.saveRemoteFileWithHash).toHaveBeenCalledWith("https://provider.test/qwen.png", expect.any(String), false, { providerId: "work-fisher" });
      expect(parentStatus).toBe("success");
      expect(parentLocalPath).toBe("/uploads/image_results/qwen.png");
      expect(JSON.parse(templateData).providerUsage).toEqual({ amount: 0.23, currency: "CNY" });
    } else expect(mocks.saveRemoteFileWithHash).not.toHaveBeenCalled();
  });

  it("finalizes a completed reAPI image task and downloads through the same provider", async () => {
    mocks.reapiGetImageTask.mockResolvedValue({
      id: "reapi-task-41",
      status: "completed",
      output: { image_urls: ["https://provider.test/reapi.png"] },
      usage: { credits: 42 },
    });
    mocks.extractReapiImageUrls.mockReturnValue(["https://provider.test/reapi.png"]);
    mocks.saveRemoteFileWithHash.mockReset().mockResolvedValue({
      localPath: "/uploads/image_results/reapi.png",
      hash: "hash-reapi",
    });
    mocks.findUnique.mockImplementation(async ({ select }: { select?: { templateData?: boolean } }) =>
      select?.templateData
        ? { templateData, updatedAt: parentUpdatedAt }
        : {
            ...generation,
            externalProvider: "reapi",
            externalTaskId: "reapi-task-41",
            createdAt: new Date(Date.now() - 31_000),
            status: parentStatus,
            localPath: parentLocalPath,
            templateData,
            updatedAt: parentUpdatedAt,
          });

    await expect(finalizeGeneration(generation.id)).resolves.toBe("done");

    expect(mocks.reapiGetImageTask).toHaveBeenCalledWith("reapi-task-41");
    expect(JSON.parse(templateData).providerUsage).toEqual({ credits: 42 });
    expect(mocks.saveRemoteFileWithHash).toHaveBeenCalledWith(
      "https://provider.test/reapi.png",
      expect.any(String),
      false,
      { providerId: "reapi" },
    );
    expect(parentStatus).toBe("success");
  });

  it.each(["apimart", "volcengine"])("saves %s Seedream layers in order, retains OCR, and bills the reference only on the base", async (provider) => {
    const sharp = (await import("sharp")).default;
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const { resolvePublicPath } = await import("@/lib/public-path");
    const root = resolvePublicPath("uploads");
    await fs.mkdir(root, {recursive:true});
    const dir = await fs.mkdtemp(path.join(root, "seedream-layer-test-"));
    const local = path.join(dir, "layer.png");
    await sharp({create:{width:960,height:960,channels:4,background:{r:0,g:0,b:0,alpha:0}}}).png().toFile(local);
    const storedPath = `/uploads/${path.basename(dir)}/layer.png`;
    templateData = JSON.stringify({imageInputCount:1,seedream55:{layerDecomposition:true,textRecognition:true}});
    mocks.findUnique.mockImplementation(async ({select}) => select?.templateData ? {templateData,updatedAt:parentUpdatedAt} : {...generation,model:provider === "apimart" ? "seedream-5.5-apimart" : "doubao-seedream-5.5",externalProvider:provider,status:parentStatus,localPath:parentLocalPath,templateData,updatedAt:parentUpdatedAt});
    mocks.create.mockReset().mockImplementation(async ({data})=>({...data,id:842}));
    const urls=["https://provider.test/base.png","https://provider.test/layer.png"];
    mocks.apimartGetTask.mockResolvedValue({data:{status:"completed",result:{images:[{url:urls,layers:[{z_index:0},{z_index:1,name:"Title",text_recognition:{text:"Hello"}}]}]}}});
    if(provider === "volcengine") {
      mocks.recoveryRead.mockResolvedValue(urls);
      templateData=JSON.stringify({imageInputCount:1,seedream55:{layerDecomposition:true,textRecognition:true},seedream55Outputs:[{layer:{z_index:0}},{layer:{z_index:1,name:"Title",text_recognition:{text:"Hello"}}}],agentOutputRecovery:{version:1,key:"private-key",items:urls.map((_,outputIndex)=>({outputIndex,state:"pending"}))}});
    }
    mocks.saveRemoteFileWithHash.mockReset().mockResolvedValue({localPath:storedPath,hash:"same-hash"});
    try {
      const result = await finalizeGeneration(41);
      expect(result, templateData).toBe("done");
      expect(mocks.create).toHaveBeenCalledTimes(1);
      const child=JSON.parse(mocks.create.mock.calls[0][0].data.templateData);
      expect(child).toMatchObject({imageInputCount:0,seedream55PixelTier:"low",seedream55OutputIndex:1,seedream55Output:{size:"960x960",layer:{text_recognition:{text:"Hello"}}}});
      expect(JSON.parse(templateData)).toMatchObject({imageInputCount:1,seedream55OutputIndex:0});
    } finally {await fs.rm(dir,{recursive:true,force:true});}
  });

  it.each(["reapi", "apimart"])("persists one %s Midjourney request as four indexed outputs with non-billable child rows", async (provider) => {
    const urls = [1, 2, 3, 4].map((index) => `https://provider.test/midjourney-${index}.png`);
    templateData = JSON.stringify({
      model: `midjourney-v8-${provider}`,
      providerModel: "midjourney",
      midjourneyV8: { version: "8.2", outputCount: 4 },
      billing: { unitType: "request", childBillable: false },
    });
    mocks.apimartGetTask.mockResolvedValue({ data: { status: "completed", result: { images: urls.map(url => ({ url })) } } });
    mocks.extractApimartImageUrls.mockReturnValue(urls);
    mocks.reapiGetImageTask.mockResolvedValue({
      id: "midjourney-task-82",
      status: "completed",
      output: { image_urls: urls },
    });
    mocks.extractReapiImageUrls.mockReturnValue(urls);
    mocks.saveRemoteFileWithHash.mockReset().mockImplementation(async (url: string) => {
      const index = urls.indexOf(url) + 1;
      return {
        localPath: `/uploads/image_results/midjourney-${index}.png`,
        hash: `hash-midjourney-${index}`,
      };
    });
    mocks.create
      .mockResolvedValueOnce({ id: 84 })
      .mockResolvedValueOnce({ id: 85 })
      .mockResolvedValueOnce({ id: 86 });
    mocks.findUnique.mockImplementation(async ({ select }: { select?: { templateData?: boolean } }) =>
      select?.templateData
        ? { templateData, updatedAt: parentUpdatedAt }
        : {
            ...generation,
            model: `midjourney-v8-${provider}`,
            externalProvider: provider,
            externalTaskId: "midjourney-task-82",
            createdAt: new Date(Date.now() - 31_000),
            status: parentStatus,
            localPath: parentLocalPath,
            templateData,
            updatedAt: parentUpdatedAt,
          });

    await expect(finalizeGeneration(generation.id)).resolves.toBe("done");

    expect(provider === "apimart" ? mocks.apimartGetTask : mocks.reapiGetImageTask).toHaveBeenCalledWith("midjourney-task-82");
    expect(mocks.saveRemoteFileWithHash).toHaveBeenCalledWith(urls[0], expect.any(String), false, { providerId: provider });
    expect(mocks.saveRemoteFileWithHash).toHaveBeenCalledTimes(4);
    expect(mocks.create).toHaveBeenCalledTimes(3);
    const childTemplates = mocks.create.mock.calls.map(([input]) => JSON.parse(input.data.templateData));
    expect(childTemplates.map((child) => child.savedOutputs[0].providerOutputIndex)).toEqual([2, 3, 4]);
    expect(childTemplates.every((child) => child.billing.billable === false)).toBe(true);
    expect(JSON.parse(templateData).savedOutputs.map((output: any) => output.providerOutputIndex)).toEqual([1, 2, 3, 4]);
    expect(parentStatus).toBe("success");
  });

  it("polls a fresh reAPI task within the shared two-second cadence", async () => {
    mocks.reapiGetImageTask.mockResolvedValue({ id: "reapi-task-41", status: "processing" });
    mocks.findUnique.mockImplementation(async ({ select }: { select?: { templateData?: boolean } }) =>
      select?.templateData
        ? { templateData, updatedAt: parentUpdatedAt }
        : {
            ...generation,
            externalProvider: "reapi",
            externalTaskId: "reapi-task-41",
            createdAt: new Date(Date.now() - 2_100),
            status: parentStatus,
            localPath: parentLocalPath,
            templateData,
            updatedAt: parentUpdatedAt,
          });

    await expect(finalizeGeneration(generation.id)).resolves.toBe("pending");
    expect(mocks.reapiGetImageTask).toHaveBeenCalledWith("reapi-task-41");
  });

  it("finalizes a completed Haiya AIComing task through the independent provider", async () => {
    mocks.aicomingHaiyaGetImageTask.mockResolvedValue({
      id: "haiya-task-41",
      status: "completed",
      data: [{ url: "https://provider.test/haiya.png" }],
    });
    mocks.extractAicomingImageUrls.mockReturnValue(["https://provider.test/haiya.png"]);
    mocks.saveRemoteFileWithHash.mockReset().mockResolvedValue({
      localPath: "/uploads/image_results/haiya.png",
      hash: "hash-haiya",
    });
    mocks.findUnique.mockImplementation(async ({ select }: { select?: { templateData?: boolean } }) =>
      select?.templateData
        ? { templateData, updatedAt: parentUpdatedAt }
        : {
            ...generation,
            externalProvider: "aicoming-haiya",
            externalTaskId: "haiya-task-41",
            status: parentStatus,
            localPath: parentLocalPath,
            templateData,
            updatedAt: parentUpdatedAt,
          });

    await expect(finalizeGeneration(generation.id)).resolves.toBe("done");

    expect(mocks.aicomingHaiyaGetImageTask).toHaveBeenCalledWith("haiya-task-41");
    expect(mocks.saveRemoteFileWithHash).toHaveBeenCalledWith(
      "https://provider.test/haiya.png",
      expect.any(String),
      false,
      { providerId: "aicoming-haiya" },
    );
    expect(parentStatus).toBe("success");
  });

  it.each(["SUCCEEDED", "FAILED", "CANCELED", "UNKNOWN", "RUNNING", "PENDING"])("handles Wan3.0 %s using the shared finalizer", async (state) => {
    templateData = JSON.stringify({agentOutputContract:{version:2,receiptId:"r",maxReturned:1}});
    mocks.wanGetVideoTask.mockResolvedValue({ output: { task_status: state, video_url: "https://provider.test/wan.mp4", message: state === "FAILED" ? "invalid input" : undefined }, usage: { input_video_duration: 3, output_video_duration: 7, video_count: 2 } });
    mocks.saveRemoteFileWithHash.mockReset().mockResolvedValue({ localPath: "/uploads/video_results/wan.mp4", hash: "hash-wan" });
    mocks.findUnique.mockImplementation(async ({ select }: { select?: { templateData?: boolean } }) => select?.templateData
      ? { templateData, updatedAt: parentUpdatedAt }
      : { ...generation, type: "video_gen", model: "wan3.0-video", externalProvider: "bailian", externalTaskId: "wan-task", status: parentStatus, localPath: parentLocalPath, templateData, updatedAt: parentUpdatedAt });
    const result = await finalizeGeneration(generation.id);
    expect(result).toBe(state === "SUCCEEDED" ? "done" : ["RUNNING", "PENDING"].includes(state) ? "pending" : "failed");
    if (state === "SUCCEEDED") {
      expect(mocks.saveRemoteFileWithHash).toHaveBeenCalledWith("https://provider.test/wan.mp4", "video_results", false, { providerId: "bailian" });
      expect(JSON.parse(templateData)).toMatchObject({ duration: 7, providerUsage: { input_video_duration: 3, output_video_duration: 7 } });
      expect(JSON.parse(templateData).agentOutputObservation).toMatchObject({rawReturned:2,uniqueOutputs:1,savedOutputs:1});
      expect(parentStatus).toBe("success");
      await expect(finalizeGeneration(generation.id)).resolves.toBe("skipped");
      expect(mocks.saveRemoteFileWithHash).toHaveBeenCalledTimes(1);
    } else expect(mocks.saveRemoteFileWithHash).not.toHaveBeenCalled();
  });

  it("finalizes a completed official MiniMax-H3 video with the V2 polling contract", async () => {
    templateData = JSON.stringify({agentOutputContract:{version:2,receiptId:"r",maxReturned:1}});
    mocks.miniMaxGetVideoTask.mockResolvedValue({
      task: {
        id: "minimax-h3-task-41",
        status: "succeeded",
        content: { url: "https://provider.test/minimax-h3.mp4" },
        usage: { output_seconds: 8 },
      },
    });
    mocks.saveRemoteFileWithHash.mockReset().mockResolvedValue({
      localPath: "/uploads/video_results/minimax-h3.mp4",
      hash: "hash-minimax-h3",
    });
    mocks.findUnique.mockImplementation(async ({ select }: { select?: { templateData?: boolean } }) =>
      select?.templateData
        ? { templateData, updatedAt: parentUpdatedAt }
        : {
            ...generation,
            type: "video_gen",
            model: "minimax-h3",
            externalProvider: "minimax",
            externalTaskId: "minimax-h3-task-41",
            status: parentStatus,
            localPath: parentLocalPath,
            templateData,
            updatedAt: parentUpdatedAt,
          });

    await expect(finalizeGeneration(generation.id)).resolves.toBe("done");

    expect(mocks.miniMaxGetVideoTask).toHaveBeenCalledWith("minimax-h3-task-41");
    expect(mocks.aicomingHaiyaGetImageTask).not.toHaveBeenCalled();
    expect(mocks.saveRemoteFileWithHash).toHaveBeenCalledWith(
      "https://provider.test/minimax-h3.mp4",
      "video_results",
      false,
      { providerId: "minimax" },
    );
    expect(JSON.parse(templateData)).toMatchObject({
      providerUsage: { output_seconds: 8 },
      agentOutputObservation:{rawCandidates:1,uniqueOutputs:1,savedOutputs:1},
    });
    expect(parentStatus).toBe("success");
  });

  it("does not let an old owner overwrite metadata after recovery installs a new claim", async () => {
    let takeoverInstalled = false;
    mocks.kieGetTaskDetail.mockResolvedValue({
      state: "success",
      resultJson: JSON.stringify({ resultUrls: ["https://provider.test/one.png"] }),
    });
    mocks.findUnique.mockImplementation(async ({ select }: { select?: { templateData?: boolean } }) => {
      if (select?.templateData && !takeoverInstalled && templateData.includes('"claimToken"')) {
        const oldOwnerSnapshot = templateData;
        parentStatus = "running";
        templateData = JSON.stringify({ phase: "saving", finalize: { claimToken: "new-owner-token" } });
        takeoverInstalled = true;
        return { templateData: oldOwnerSnapshot, updatedAt: parentUpdatedAt };
      }
      return select?.templateData
        ? { templateData, updatedAt: parentUpdatedAt }
        : { ...generation, status: parentStatus, localPath: parentLocalPath, templateData, updatedAt: parentUpdatedAt };
    });

    await expect(finalizeGeneration(generation.id)).resolves.toBe("skipped");

    expect(takeoverInstalled).toBe(true);
    expect(parentStatus).toBe("running");
    expect(templateData).toContain("new-owner-token");
    expect(templateData).not.toContain("/uploads/image_results/one.png");
  });

  it("does not let delayed success projections hold the terminal claim open", async () => {
    const terminalUsage = deferred<undefined>();
    const terminalFeed = deferred<undefined>();
    const usageStatuses: string[] = [];
    const feedStatuses: string[] = [];
    mocks.create.mockResolvedValue({ id: 84 });
    mocks.upsertUsageLedgerForGeneration.mockImplementation((row: { id: number; status: string }) => {
      usageStatuses.push(row.status);
      return row.id === generation.id && row.status === "success" ? terminalUsage.promise : Promise.resolve(undefined);
    });
    mocks.upsertAdminAssetFeedForRows.mockImplementation((rows: Array<{ id: number; status: string }>) => {
      feedStatuses.push(rows[0]?.status);
      return rows[0]?.id === generation.id && rows[0]?.status === "success" ? terminalFeed.promise : Promise.resolve(undefined);
    });

    const completion = finalizeGeneration(generation.id);
    await waitFor(() => usageStatuses.includes("success"));
    await expect(completion).resolves.toBe("done");
    expect(parentStatus).toBe("success");
    expect(parentLocalPath).toMatch(/^\/uploads\/image_results\/(?:one|two)\.png$/);
    terminalUsage.resolve(undefined);
    terminalFeed.resolve(undefined);
    expect(mocks.transaction).toHaveBeenCalledTimes(2);
  });

  it("does not let delayed failure projections hold the terminal claim open", async () => {
    const terminalUsage = deferred<undefined>();
    const terminalFeed = deferred<undefined>();
    const usageStatuses: string[] = [];
    const feedStatuses: string[] = [];
    mocks.kieGetTaskDetail.mockResolvedValue({ state: "fail", failMsg: "provider failed" });
    mocks.upsertUsageLedgerForGeneration.mockImplementation((row: { status: string }) => {
      usageStatuses.push(row.status);
      return row.status === "failed" && usageStatuses.length === 1 ? terminalUsage.promise : Promise.resolve(undefined);
    });
    mocks.upsertAdminAssetFeedForRows.mockImplementation((rows: Array<{ status: string }>) => {
      feedStatuses.push(rows[0]?.status);
      return rows[0]?.status === "failed" && feedStatuses.length === 1 ? terminalFeed.promise : Promise.resolve(undefined);
    });

    const completion = finalizeGeneration(generation.id);
    await waitFor(() => usageStatuses.includes("failed"));
    await expect(completion).resolves.toBe("failed");
    expect(parentStatus).toBe("failed");
    terminalUsage.resolve(undefined);
    terminalFeed.resolve(undefined);
    expect(parentLocalPath).toBeNull();
    expect(mocks.transaction).toHaveBeenCalledOnce();
  });

  it("does not wait for terminal projections after the terminal row is durable", async () => {
    const terminalUsage = deferred<undefined>();
    const terminalFeed = deferred<undefined>();
    mocks.create.mockResolvedValue({ id: 84 });
    mocks.upsertUsageLedgerForGeneration.mockImplementation((row: { id: number; status: string }) =>
      row.id === generation.id && row.status === "success" ? terminalUsage.promise : Promise.resolve(undefined));
    mocks.upsertAdminAssetFeedForRows.mockImplementation((rows: Array<{ id: number; status: string }>) =>
      rows[0]?.id === generation.id && rows[0]?.status === "success" ? terminalFeed.promise : Promise.resolve(undefined));

    const completion = finalizeGeneration(generation.id);
    await waitFor(() => mocks.upsertUsageLedgerForGeneration.mock.calls.length > 0);

    await expect(completion).resolves.toBe("done");
    expect(parentStatus).toBe("success");

    terminalUsage.resolve(undefined);
    terminalFeed.resolve(undefined);
  });

  it("reuses an already-created extra and binds its id atomically", async () => {
    mocks.findFirst.mockResolvedValue({ id: 84, status: "success" });

    await expect(finalizeGeneration(generation.id)).resolves.toBe("done");
    expect(mocks.create).not.toHaveBeenCalled();
    expect(parentStatus).toBe("success");
    expect(templateData).toContain('"generationId":84');
  });

  it("keeps a repeated completion callback idempotent after all outputs are durable", async () => {
    mocks.create.mockResolvedValue({ id: 84 });

    await expect(finalizeGeneration(generation.id)).resolves.toBe("done");
    await expect(finalizeGeneration(generation.id)).resolves.toBe("skipped");

    expect(mocks.create).toHaveBeenCalledOnce();
    expect(parentStatus).toBe("success");
    expect(templateData).toContain('"generationId":84');
  });

  it("does not leave an orphan child when the parent claim is cancelled during child lookup", async () => {
    mocks.create.mockReset().mockResolvedValue({ id: 84 });
    mocks.findFirst.mockImplementationOnce(async () => {
      parentStatus = "cancelled";
      return null;
    });

    await expect(finalizeGeneration(generation.id)).resolves.toBe("skipped");

    expect(parentStatus).toBe("cancelled");
    expect(templateData).not.toContain('"generationId":84');
    expect(mocks.transaction).toHaveBeenCalled();
  });

  it("heartbeats a long display-asset build and stops before the child transaction after claim loss", async () => {
    vi.useFakeTimers();
    const displayPatch = deferred<Record<string, never>>();
    mocks.createGenerationDisplayAssetPatch.mockReturnValueOnce(displayPatch.promise);

    const completion = finalizeGeneration(generation.id);
    for (let attempt = 0; attempt < 30 && mocks.createGenerationDisplayAssetPatch.mock.calls.length === 0; attempt += 1) {
      await vi.advanceTimersByTimeAsync(0);
    }
    expect(mocks.createGenerationDisplayAssetPatch).toHaveBeenCalledOnce();
    parentStatus = "cancelled";
    await vi.advanceTimersByTimeAsync(30_000);
    displayPatch.resolve({});

    await expect(completion).resolves.toBe("skipped");
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});

describe("all multi-output completion paths keep the parent terminal write last", () => {
  it("keeps every synchronous image-service extra creation before its parent success write", () => {
    const source = readFileSync(resolve(process.cwd(), "lib/generation/image-service.ts"), "utf8");
    const completionBlocks = source.split("void (async () => {").slice(1);
    const multiOutputBlocks = completionBlocks.filter((block) => block.includes("createExtraImageGenerationRecordIfMissing"));

    expect(multiOutputBlocks.length).toBeGreaterThan(0);
    for (const block of multiOutputBlocks) {
      expect(block.indexOf("createExtraImageGenerationRecordIfMissing"))
        .toBeLessThan(block.indexOf('status: "success"'));
    }
  });

  it("uses the source-aware result folder for every synchronous image download", () => {
    const source = readFileSync(resolve(process.cwd(), "lib/generation/image-service.ts"), "utf8");

    expect(source).toContain('const outputFolder = generationOutputFolder("image_edit", source);');
    expect(source).toContain('generationOutputFolder("image_edit", input.source)');
    expect(source).not.toContain('"image_results"');
  });
});
