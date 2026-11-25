import "server-only";
import prisma from "@/lib/prisma";
import { creativeAgentStore } from "./store";
import {
  creativeAgentStableId,
  creativeAgentNodeHash,
  readCreativeAgentCanvas,
} from "./canvas-tools";
import { requireCreativeAgentCanvas } from "./access";
import { CreativeAgentError } from "./errors";
import { submitCanvasMutation } from "@/lib/canvas/mutation-service";
import { createPrismaCanvasMutationStore } from "@/lib/canvas/prisma-mutation-store";
import type { CanvasOperation } from "@/lib/canvas/operations";

export type CreativeUndo = {
  nodeId: string;
  expectedHash: string;
  previous: { title?: string; text?: string } | null;
}[];
export const creativeUndoKey = (actionId: string) =>
  `creative-agent:undo:v1:${actionId}`;

export async function undoCreativeAction(
  actorUserId: number,
  actionId: string,
) {
  const action = await creativeAgentStore.getAction(actionId);
  if (
    action.actorUserId !== actorUserId ||
    action.state !== "succeeded" ||
    !["canvas.create", "canvas.patch"].includes(action.kind)
  )
    throw new CreativeAgentError(
      "ACTION_NOT_UNDOABLE",
      "这项操作不能撤销",
      400,
    );
  await requireCreativeAgentCanvas(actorUserId, action.canvasId, true);
  const mutationId = creativeAgentStableId(`undo:${actionId}`);
  const existing = await prisma.canvasMutation.findFirst({
    where: {
      canvasId: action.canvasId,
      actorUserId,
      clientMutationId: mutationId,
    },
  });
  if (existing) return { revision: existing.revision.toString(), undone: true };
  const row = await prisma.appSetting.findUnique({
    where: { key: creativeUndoKey(actionId) },
  });
  if (!row)
    throw new CreativeAgentError(
      "ACTION_NOT_UNDOABLE",
      "此操作没有可用的撤销记录",
      400,
    );
  const steps = JSON.parse(row.value) as CreativeUndo;
  const canvas = await readCreativeAgentCanvas(actorUserId, action.canvasId);
  for (const step of steps) {
    const node = canvas.nodes.find((item) => item.id === step.nodeId);
    if (!node || creativeAgentNodeHash(node) !== step.expectedHash)
      throw new CreativeAgentError(
        "TARGET_CHANGED",
        "成果已被修改，不能覆盖后续改动；请让 Agent 按当前版本局部调整",
        409,
      );
    if (step.previous === null) {
      const edge = await prisma.canvasEdgeState.findFirst({
        where: {
          canvasId: action.canvasId,
          OR: [{ sourceId: step.nodeId }, { targetId: step.nodeId }],
        },
      });
      if (canvas.nodes.some((item) => item.parentId === step.nodeId))
        throw new CreativeAgentError(
          "TARGET_CHANGED",
          "分组中已有内容，请先移出后再撤销",
          409,
        );
      if (edge)
        throw new CreativeAgentError(
          "TARGET_CHANGED",
          "成果已有连线，请先处理相关依赖后再撤销",
          409,
        );
    }
  }
  const operations: CanvasOperation[] = steps.map((step, index) =>
    step.previous === null
      ? {
          opId: `${mutationId}:${index}`,
          kind: "node.delete",
          nodeId: step.nodeId,
        }
      : {
          opId: `${mutationId}:${index}`,
          kind: "node.patch",
          nodeId: step.nodeId,
          patch: { data: step.previous },
        },
  );
  const result = await submitCanvasMutation(
    {
      actorUserId,
      canvasId: action.canvasId,
      input: {
        protocolVersion: 1,
        clientMutationId: mutationId,
        clientSequence: 0,
        baseRevision: canvas.revision,
        operations,
      },
    },
    createPrismaCanvasMutationStore(prisma),
  );
  return { revision: result.revision, undone: true };
}
