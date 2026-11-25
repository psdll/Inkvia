import "server-only";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { requireCreativeAgentCanvas } from "./access";
import {
  creativeAgentNodeHash,
  readCreativeAgentCanvas,
  resolveCreativeAgentSelection,
} from "./canvas-tools";
import { creativeAgentReferenceSchema } from "./schemas";
import { CreativeAgentError } from "./errors";
import {
  creativeStages,
  type CreativeProject,
  type CreativeProgress,
  type CreativeProjectSnapshot,
} from "./project-contracts";
import type { ToolExecutionInput } from "./tools";
import { creativeAgentStore } from "./store";
import { hash, type DecisionPrompt } from "./store-types";
import { getCreativeAgentSelection } from "./canvas-selection";

const projectKey = (canvasId: number) =>
  `creative-agent:project:v1:${canvasId}`;
const progressKey = (sessionId: string) =>
  `creative-agent:progress:v1:${sessionId}`;
const emptyProject = (): CreativeProject => ({
  version: 1,
  revision: 0,
  constraints: [],
  artifacts: [],
  updatedAt: null,
});
const emptyProgress = (): CreativeProgress => ({
  stage: "brief",
  nextAction: "",
  questions: [],
});
export const projectUpdateSchema = z
  .object({
    expectedRevision: z.number().int().nonnegative(),
    constraints: z.array(z.string().trim().min(1).max(500)).max(40).optional(),
    artifact: z
      .object({
        reference: creativeAgentReferenceSchema,
        status: z.enum(["confirmed", "adopted"]),
        dependencies: z.array(z.string().max(256)).max(30).default([]),
      })
      .strict()
      .optional(),
    revokeId: z.string().max(256).optional(),
    reason: z.string().max(1000).optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.constraints !== undefined || value.artifact || value.revokeId,
    "需要指定确认内容",
  );
export const projectProgressSchema = z
  .object({
    stage: z.enum(creativeStages),
    nextAction: z.string().max(1500),
    questions: z.array(z.string().max(500)).max(12),
  })
  .strict();

export async function readCreativeProject(
  actorUserId: number,
  canvasId: number,
  sessionId: string,
  nodeIds?: string[],
  includeCandidates = true,
): Promise<CreativeProjectSnapshot> {
  await requireCreativeAgentCanvas(actorUserId, canvasId);
  await creativeAgentStore.getSession(actorUserId, canvasId, sessionId);
  const [record, progressRecord] = await Promise.all([
    prisma.appSetting.findUnique({ where: { key: projectKey(canvasId) } }),
    prisma.appSetting.findUnique({ where: { key: progressKey(sessionId) } }),
  ]);
  const project: CreativeProject = record
    ? JSON.parse(record.value)
    : emptyProject();
  const canvas = await readCreativeAgentCanvas(actorUserId, canvasId, includeCandidates ? undefined : [...new Set(project.artifacts.filter(a => a.status !== "revoked").map(a => a.nodeId))]);
  const progress: CreativeProgress = progressRecord
    ? projectProgressSchema.parse(JSON.parse(progressRecord.value))
    : emptyProgress();
  const changes: CreativeProjectSnapshot["changes"] = [];
  const affected = new Set<string>();
  for (const artifact of project.artifacts) {
    if (artifact.status === "revoked") continue;
    const node = canvas.nodes.find((item) => item.id === artifact.nodeId);
    if (!node || creativeAgentNodeHash(node) !== artifact.semanticHash) {
      affected.add(artifact.id);
      changes.push({
        artifactId: artifact.id,
        title: artifact.title,
        reason: node
          ? "画布内容已改变，已保存的确认版本仍保留；继续使用前请核对"
          : "源节点已移除，确认记录保留但不能直接提交生成",
      });
    }
  }
  for (let pass = 0; pass < project.artifacts.length; pass++) {
    let added = false;
    for (const artifact of project.artifacts) {
      if (artifact.status === "revoked" || affected.has(artifact.id)) continue;
      if (
        artifact.dependencies.some(
          (id) =>
            affected.has(id) ||
            !project.artifacts.some(
              (item) => item.id === id && item.status !== "revoked",
            ),
        )
      ) {
        affected.add(artifact.id);
        added = true;
        changes.push({
          artifactId: artifact.id,
          title: artifact.title,
          reason: "所依赖的确认版本已变化或撤销，需要复核相关部分",
        });
      }
    }
    if (!added) break;
  }
  const candidates = (includeCandidates ? canvas.nodes : [])
    .filter(
      (node) =>
        (!nodeIds || nodeIds.includes(node.id)) &&
        [
          "prompt",
          "image",
          "video",
          "audio",
          "imageTask",
          "videoTask",
          "audioTask",
        ].includes(node.data.kind),
    )
    .slice(0, 200)
    .flatMap((node) => {
      const selection = getCreativeAgentSelection(
        canvasId,
        { nodes: [node], edges: [] },
        [node.id],
        [],
        true,
      );
      return selection.references.map((ref) => ({
        ...ref,
        semanticHash: creativeAgentNodeHash(node),
      }));
    });
  return { project, progress, changes, candidates };
}

async function lockProjectRun(
  tx: Prisma.TransactionClient,
  input: ToolExecutionInput,
) {
  await tx.$queryRaw`SELECT id FROM "CreativeAgentRun" WHERE id=${input.runId} FOR UPDATE`;
  const run = await tx.creativeAgentRun.findUnique({
    where: { id: input.runId },
  });
  if (
    !run ||
    run.actorUserId !== input.actorUserId ||
    run.canvasId !== input.canvasId ||
    run.epoch !== input.epoch ||
    !["running", "waiting_decision", "waiting_action"].includes(run.status) ||
    !run.leaseExpiresAt ||
    run.leaseExpiresAt.getTime() <= Date.now()
  )
    throw new CreativeAgentError(
      "STALE_RUN",
      "任务已停止或执行权限已失效",
      409,
    );
  return run;
}

export async function prepareCreativeProjectDecision(
  input: ToolExecutionInput,
): Promise<DecisionPrompt> {
  await requireCreativeAgentCanvas(input.actorUserId, input.canvasId, true);
  const update = projectUpdateSchema.parse(input.args);
  const record = await prisma.appSetting.findUnique({
    where: { key: projectKey(input.canvasId) },
  });
  const project: CreativeProject = record
    ? JSON.parse(record.value)
    : emptyProject();
  if (project.revision !== update.expectedRevision)
    throw new CreativeAgentError(
      "PROJECT_CONFLICT",
      "项目约定已有更新，请重新读取后确认",
      409,
    );
  const lines = ["以下内容将保存为此画布共享的确认记录："];
  if (update.constraints)
    lines.push(
      "完整项目约定：",
      ...update.constraints.map((text, index) => `${index + 1}. ${text}`),
    );
  if (update.artifact) {
    const ref = update.artifact.reference;
    if (!ref.semanticHash)
      throw new CreativeAgentError(
        "REFERENCE_CHANGED",
        "确认前需要读取固定素材版本",
        409,
      );
    const canvas = await readCreativeAgentCanvas(
      input.actorUserId,
      input.canvasId,
    );
    resolveCreativeAgentSelection(input.canvasId, canvas, {
      nodeIds: [ref.nodeId],
      edgeIds: [],
      references: [ref],
    });
    const node = canvas.nodes.find((item) => item.id === ref.nodeId)!;
    lines.push(
      `${update.artifact.status === "confirmed" ? "确认定稿" : "采用结果"}：${ref.label}`,
      `节点：${ref.nodeId}；类型：${ref.kind}`,
      `版本：${ref.semanticHash}`,
      ...[
        ref.batchId && `批次：${ref.batchId}`,
        ref.outputId && `输出：${ref.outputId}`,
        ref.mediaId && `媒体：${ref.mediaId}`,
        ref.generationId && `生成记录：${ref.generationId}`,
      ].filter((value): value is string => typeof value === "string"),
    );
    if ("title" in node.data && typeof node.data.title === "string")
      lines.push(`标题：${node.data.title}`);
    if ("model" in node.data && typeof node.data.model === "string")
      lines.push(`模型：${node.data.model}`);
    if (node.data.kind === "imageTask")
      lines.push(
        `模型：${node.data.task.batches.find((batch) => batch.id === ref.batchId)?.settings.model || node.data.task.settings.model}`,
      );
    if (node.data.kind === "prompt") lines.push("完整文本：", node.data.text);
    if (update.artifact.dependencies.length)
      lines.push(
        `依赖版本：${update.artifact.dependencies.map((id) => project.artifacts.find((item) => item.id === id)?.title || id).join("、")}`,
      );
  }
  if (update.revokeId)
    lines.push(
      `撤销确认：${project.artifacts.find((item) => item.id === update.revokeId)?.title || update.revokeId}`,
      `原因：${update.reason || "用户撤销采用"}`,
    );
  return {
    title: "确认项目约定与采用版本",
    question: lines.join("\n"),
    options: [
      { value: "approve", label: "确认保存" },
      { value: "cancel", label: "暂不保存" },
    ],
    binding: { kind: input.kind, argsHash: hash(input.args), units: 1 },
  };
}

export async function updateCreativeProject(
  actorUserId: number,
  canvasId: number,
  raw: unknown,
  requestId: string,
  runInput?: ToolExecutionInput,
) {
  await requireCreativeAgentCanvas(actorUserId, canvasId, true);
  const input = projectUpdateSchema.parse(raw);
  return prisma.$transaction(async (tx) => {
    if (runInput) await lockProjectRun(tx, runInput);
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${projectKey(canvasId)},0))::text`;
    const receiptKey = `creative-agent:project-receipt:${canvasId}:${requestId}`;
    const stored = await tx.appSetting.findUnique({
      where: { key: projectKey(canvasId) },
    });
    const current: CreativeProject = stored
      ? JSON.parse(stored.value)
      : emptyProject();
    const previous = await tx.appSetting.findUnique({
      where: { key: receiptKey },
    });
    if (previous) {
      const receipt = JSON.parse(previous.value);
      if (receipt.inputHash !== hash(input))
        throw new CreativeAgentError(
          "PROJECT_CONFLICT",
          "确认请求已用于其他内容",
          409,
        );
      return current;
    }
    if (current.revision !== input.expectedRevision)
      throw new CreativeAgentError(
        "PROJECT_CONFLICT",
        "项目约定已有更新，请重新查看后确认",
        409,
      );
    const canvas = input.artifact
      ? await readCreativeAgentCanvas(actorUserId, canvasId)
      : null;
    let artifact: CreativeProject["artifacts"][number] | undefined;
    if (input.artifact && canvas) {
      const ref = input.artifact.reference;
      if (!ref.semanticHash)
        throw new CreativeAgentError(
          "REFERENCE_CHANGED",
          "确认前需要重新读取素材版本",
          409,
        );
      const selection = resolveCreativeAgentSelection(canvasId, canvas, {
        nodeIds: [ref.nodeId],
        edgeIds: [],
        references: [ref],
      });
      const node = canvas.nodes.find((item) => item.id === ref.nodeId)!;
      if (input.artifact.status === "adopted") {
        if (
          ![
            "image",
            "video",
            "audio",
            "imageTask",
            "videoTask",
            "audioTask",
          ].includes(node.data.kind)
        )
          throw new CreativeAgentError(
            "REFERENCE_KIND_INVALID",
            "采用仅适用于实际媒体结果",
            400,
          );
        if (node.data.kind === "imageTask" && (!ref.batchId || !ref.outputId))
          throw new CreativeAgentError(
            "REFERENCE_NOT_READY",
            "请选择具体候选图片后再采用",
            400,
          );
        if (
          ["videoTask", "audioTask"].includes(node.data.kind) &&
          (!("status" in node.data) ||
            node.data.status !== "success" ||
            !ref.outputId)
        )
          throw new CreativeAgentError(
            "REFERENCE_NOT_READY",
            "素材尚未生成完成",
            400,
          );
      } else if (node.data.kind !== "prompt")
        throw new CreativeAgentError(
          "REFERENCE_KIND_INVALID",
          "文字定稿请选择文本成果节点",
          400,
        );
      artifact = {
        ...selection.references[0],
        id: `artifact_${hash({ canvasId, requestId })}`,
        title: ref.label,
        semanticHash: ref.semanticHash,
        status: input.artifact.status,
        dependencies: input.artifact.dependencies,
        recordedAt: new Date().toISOString(),
        recordedBy: actorUserId,
        ...(node.data.kind === "prompt" ? { text: node.data.text } : {}),
      };
    }

    if (
      artifact?.dependencies.some(
        (id) =>
          !current.artifacts.some(
            (item) => item.id === id && item.status !== "revoked",
          ),
      )
    )
      throw new CreativeAgentError(
        "PROJECT_CONFLICT",
        "引用的确认版本已失效",
        409,
      );
    if (
      input.revokeId &&
      !current.artifacts.some((item) => item.id === input.revokeId)
    )
      throw new CreativeAgentError("PROJECT_CONFLICT", "确认记录不存在", 404);
    const duplicate =
      artifact &&
      current.artifacts.some(
        (item) =>
          item.status === artifact!.status &&
          hash({
            nodeId: item.nodeId,
            semanticHash: item.semanticHash,
            outputId: item.outputId,
            batchId: item.batchId,
            dependencies: item.dependencies,
          }) ===
            hash({
              nodeId: artifact!.nodeId,
              semanticHash: artifact!.semanticHash,
              outputId: artifact!.outputId,
              batchId: artifact!.batchId,
              dependencies: artifact!.dependencies,
            }),
      );
    if (duplicate && input.constraints === undefined && !input.revokeId) {
      await tx.appSetting.create({
        data: {
          key: receiptKey,
          value: JSON.stringify({
            inputHash: hash(input),
            revision: current.revision,
          }),
        },
      });
      return current;
    }
    if (duplicate) artifact = undefined;
    if (artifact && current.artifacts.length >= 300)
      throw new CreativeAgentError(
        "PROJECT_CONFLICT",
        "确认记录已达到当前项目容量，请拆分制作画布",
        400,
      );
    const project: CreativeProject = {
      ...current,
      revision: current.revision + 1,
      updatedAt: new Date().toISOString(),
      constraints: input.constraints ?? current.constraints,
      artifacts: [
        ...current.artifacts.map((item) =>
          item.id === input.revokeId
            ? {
                ...item,
                status: "revoked" as const,
                reason: input.reason || "用户撤销采用",
              }
            : item,
        ),
        ...(artifact ? [artifact] : []),
      ],
    };
    await tx.appSetting.upsert({
      where: { key: projectKey(canvasId) },
      create: { key: projectKey(canvasId), value: JSON.stringify(project) },
      update: { value: JSON.stringify(project) },
    });
    await tx.appSetting.create({
      data: {
        key: receiptKey,
        value: JSON.stringify({
          inputHash: hash(input),
          revision: project.revision,
        }),
      },
    });
    return project;
  });
}

export async function executeCreativeProjectTool(
  input: ToolExecutionInput,
): Promise<Record<string, unknown>> {
  const run = await creativeAgentStore.assertFence(input.runId, input.epoch);
  if (input.kind === "project.read") {
    const { candidates: _candidates, ...state } = await readCreativeProject(
      input.actorUserId,
      input.canvasId,
      run.sessionId,
      [],
    );
    return state;
  }
  if (input.kind === "project.progress") {
    const progress = projectProgressSchema.parse(input.args);
    const key = progressKey(run.sessionId);
    await requireCreativeAgentCanvas(input.actorUserId, input.canvasId, true);
    await prisma.$transaction(async (tx) => {
      const locked = await lockProjectRun(tx, input);
      if (locked.sessionId !== run.sessionId)
        throw new CreativeAgentError("STALE_RUN", "任务范围已变化", 409);
      await tx.appSetting.upsert({
        where: { key },
        create: { key, value: JSON.stringify(progress) },
        update: { value: JSON.stringify(progress) },
      });
    });
    return { progress };
  }
  const decision = input.mediaApproval
    ? await creativeAgentStore.getDecision(input.mediaApproval.decisionId)
    : null;
  if (
    !decision ||
    decision.runId !== run.id ||
    decision.actionId !== input.actionId ||
    decision.proposalHash !== input.mediaApproval?.proposalHash ||
    decision.state !== "answered" ||
    decision.answer !== "approve" ||
    decision.binding?.argsHash !== hash(input.args)
  )
    throw new CreativeAgentError(
      "MEDIA_APPROVAL_REQUIRED",
      "请先确认具体项目约定或采用版本",
      409,
    );
  return {
    project: await updateCreativeProject(
      input.actorUserId,
      input.canvasId,
      input.args,
      input.actionId,
      input,
    ),
  };
}
