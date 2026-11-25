import { z } from "zod";
import { LLM_THINKING_LEVELS } from "@/lib/llm-routing/reasoning";
import { mediaRevisionAnswerSchema, structuredQuestionAnswerSchema } from "./questions";

const id = z.string().min(1).max(256);
const imagePreferenceParams = z.object({ aspectRatio: id.optional(), resolution: id.optional(), quality: id.optional(), background: id.optional() }).strict();
const videoPreferenceParams = z.object({ ratio: id.optional(), resolution: id.optional(), duration: z.number().finite().int().positive().safe().optional(), generateAudio: z.boolean().optional() }).strict();
export const creativeAgentPreferencesSchema = z.object({
  imageModel: id.optional(), videoModel: id.optional(),
  image: z.discriminatedUnion("mode", [
    z.object({ mode: z.literal("auto"), params: imagePreferenceParams.optional() }).strict(),
    z.object({ mode: z.literal("explicit"), model: id, params: imagePreferenceParams.optional() }).strict(),
  ]).optional(),
  video: z.discriminatedUnion("mode", [
    z.object({ mode: z.literal("auto"), params: videoPreferenceParams.optional() }).strict(),
    z.object({ mode: z.literal("explicit"), model: id, params: videoPreferenceParams.optional() }).strict(),
  ]).optional(),
}).strict();
export const creativeAgentReferenceSchema = z.object({
  canvasId: z.number().int().positive().safe(), nodeId: id, label: z.string().max(512), kind: z.string().max(64),
  batchId: id.optional(), outputId: id.optional(), mediaId: id.optional(), generationId: z.number().int().positive().safe().optional(),
  semanticHash: z.string().max(128).optional(),
  purpose: z.enum(["identity", "scene", "style", "composition", "content"]).optional(),
}).strict();
export const creativeAgentSelectionSchema = z.object({
  nodeIds: z.array(id).max(100), edgeIds: z.array(id).max(100), references: z.array(creativeAgentReferenceSchema).max(100),
}).strict();
export const creativeAgentMessageSchema = z.object({
  messageId: z.string().uuid(), sessionId: id.optional(), text: z.string().trim().min(1).max(20000),
  model: z.object({ providerId: id, modelId: id }).strict().optional(),
  thinkingLevel: z.enum([...LLM_THINKING_LEVELS, "off"]).optional(),
  attachments: z.array(z.object({ id: z.string().uuid() }).strict()).max(6).optional(),
  preferences: creativeAgentPreferencesSchema.optional(),
  selectedSkillId: z.string().regex(/^(system|personal):[1-9]\d*$/).nullable().optional(),
  referenceMode: z.enum(["replace", "clear", "combine"]).optional(),
  baseRevision: z.string().regex(/^(0|[1-9]\d*)$/).max(20), selection: creativeAgentSelectionSchema,
}).strict();
export const creativeAgentControlSchema = z.object({
  requestId: z.string().uuid(), action: z.enum(["pause", "stop", "resume", "continue"]),
}).strict();
export const creativeAgentMessageRevisionSchema = z.object({
  runId: id, messageId: id, requestId: z.string().uuid(),
  text: z.string().trim().min(1).max(20000), expectedText: z.string().min(1).max(20000),
}).strict();
export const creativeAgentAnswerSchema = z.object({
  requestId: z.string().uuid(), proposalHash: z.string().min(1).max(128), answer: z.union([z.string().min(1).max(10000), structuredQuestionAnswerSchema, mediaRevisionAnswerSchema]),
}).strict();
export const creativeAgentCanvasIdSchema = z.coerce.number().int().positive().safe();

export const creativeAgentSessionIdSchema = z.string().uuid();
export const creativeAgentCreateSessionSchema = z.object({ sessionId: creativeAgentSessionIdSchema }).strict();
export const creativeAgentRenameSessionSchema = z.object({ sessionId: creativeAgentSessionIdSchema, title: z.string().trim().min(1).max(80) }).strict();
