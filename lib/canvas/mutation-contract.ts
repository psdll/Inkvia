import { createHash } from "node:crypto";
import { z } from "zod";
import { canvasEdgeSchema, canvasNodeSchema } from "@/lib/canvas/document";
import {
  CANVAS_OPERATION_PROTOCOL_VERSION,
  validateCanvasMutationBatch,
  type CanvasOperation,
} from "@/lib/canvas/operations";

const opId = z.string().min(1).max(128);
const entityId = z.string().min(1).max(256);
const finitePoint = z.object({ x: z.number().finite(), y: z.number().finite() }).strict();
const nodeDataPatch = z.record(z.unknown());
const nodePatch = z.object({
  data: nodeDataPatch.optional(),
  unsetDataKeys: z.array(z.string().min(1).max(128)).max(100).optional(),
  hidden: z.boolean().nullable().optional(),
  zIndex: z.number().int().nullable().optional(),
}).strict();
const edgePatch = z.object({
  source: entityId.optional(),
  target: entityId.optional(),
  sourceHandle: z.string().nullable().optional(),
  targetHandle: z.string().nullable().optional(),
  type: z.enum(["default", "smoothstep"]).optional(),
}).strict();

const canvasOperationSchema = z.discriminatedUnion("kind", [
  z.object({ opId, kind: z.literal("node.create"), node: canvasNodeSchema, index: z.number().int().nonnegative().optional() }).strict(),
  z.object({ opId, kind: z.literal("node.patch"), nodeId: entityId, patch: nodePatch }).strict(),
  z.object({ opId, kind: z.literal("node.move"), nodeId: entityId, position: finitePoint }).strict(),
  z.object({
    opId,
    kind: z.literal("node.resize"),
    nodeId: entityId,
    width: z.number().finite().positive().nullable(),
    height: z.number().finite().positive().nullable(),
  }).strict(),
  z.object({ opId, kind: z.literal("node.reparent"), nodeId: entityId, parentId: entityId.nullable() }).strict(),
  z.object({ opId, kind: z.literal("node.delete"), nodeId: entityId }).strict(),
  z.object({ opId, kind: z.literal("edge.create"), edge: canvasEdgeSchema, index: z.number().int().nonnegative().optional() }).strict(),
  z.object({ opId, kind: z.literal("edge.patch"), edgeId: entityId, patch: edgePatch }).strict(),
  z.object({ opId, kind: z.literal("edge.delete"), edgeId: entityId }).strict(),
  z.object({
    opId,
    kind: z.literal("canvas.settings.patch"),
    patch: z.object({ snapToGrid: z.boolean().optional(), gridSize: z.number().int().positive().optional() }).strict(),
  }).strict(),
]);

const canvasMutationRequestSchema = z.object({
  protocolVersion: z.literal(CANVAS_OPERATION_PROTOCOL_VERSION),
  clientMutationId: z.string().uuid(),
  clientSequence: z.number().int().nonnegative().safe(),
  baseRevision: z.string().regex(/^(0|[1-9]\d*)$/),
  operations: z.array(canvasOperationSchema),
}).strict();

export type CanvasMutationRequest = {
  protocolVersion: typeof CANVAS_OPERATION_PROTOCOL_VERSION;
  clientMutationId: string;
  clientSequence: number;
  baseRevision: string;
  operations: CanvasOperation[];
};

export class CanvasMutationContractError extends Error {
  constructor(public readonly code: string, message: string, public readonly issues?: z.ZodIssue[]) {
    super(message);
    this.name = "CanvasMutationContractError";
  }
}

export function parseCanvasMutationRequest(value: unknown): CanvasMutationRequest {
  const parsed = canvasMutationRequestSchema.safeParse(value);
  if (!parsed.success) {
    throw new CanvasMutationContractError("MUTATION_REQUEST_INVALID", "Invalid canvas mutation request", parsed.error.issues);
  }
  try {
    validateCanvasMutationBatch(parsed.data.operations as CanvasOperation[]);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid canvas mutation batch";
    const code = typeof error === "object" && error && "code" in error && typeof error.code === "string"
      ? error.code
      : "MUTATION_REQUEST_INVALID";
    throw new CanvasMutationContractError(code, message);
  }
  return parsed.data as CanvasMutationRequest;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    const item = (value as Record<string, unknown>)[key];
    if (item !== undefined) result[key] = canonicalize(item);
  }
  return result;
}

export function canonicalCanvasMutationPayload(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function hashCanvasMutationPayload(value: unknown): string {
  return createHash("sha256").update(canonicalCanvasMutationPayload(value), "utf8").digest("hex");
}
