import { subjectIntentSchema, conversationMediaArgs, emptyConversationContext, resolveConversationSkill, conversationContextPolicy, validatedSubjectIntent, mediaReference, anchorWithReceiptVersions, isConversationMediaReference, sameConversationReferences, type ConversationContext } from "./conversation-context";
import { wakeCreativeAgentWorker } from "./worker-wake";
import { projectLlmUsage, summarizeLlmAttempts, type CreativeLlmAttempt } from "./call-metrics";
import { reserveGenerationQuantity, transitionGenerationReservation, observeGenerationQuantity, type GenerationReservationInput, type GenerationObservation } from "./quantity";
import type { GenerationPlan } from "./generation-plan";
import { CreativeAgentError } from "./errors";
import { mergeTurnRequirements, newMatchingPreferences, requirementContains, turnRequirementsSchema, type RequirementEvidence } from "./matching-contracts";
import { creativeToolPresentation } from "./tool-presentation";
import { summarizeCreativeAgentUsage } from "./usage";
import { mediaRevisionAnswerSchema, questionFieldsSchema, validateQuestionAnswer } from "./questions";
import { randomUUID } from "node:crypto";
import type { PrismaClient, Prisma } from "@prisma/client";
import type { CreativeAgentReference, CreativeAgentMedia, CreativeAgentMessageRevision, CreativeAgentSessionSummary, CreativeAgentThinking } from "./contracts";
import prisma from "@/lib/prisma";
import { assertDurableWorkAdmission } from "@/lib/maintenance";
import { hash, modelFrontierHash, type ModelFrontier, HttpError, isTerminal, type Action, type ActionState, type Decision, type DecisionPrompt, type Event, type EventType, type Message, type MessageInput, type Run, type RunStatus } from "./store-types";

type Row = Record<string, any>;
type Client = PrismaClient | Prisma.TransactionClient;
type DB = { query(sql: string, values?: unknown[]): Promise<{ rows: Row[]; rowCount: number }> };
function adapter(client: Client): DB {
  return { async query(sql, values = []) {
    if (!/^\s*SELECT\b/i.test(sql) && !/\bRETURNING\b/i.test(sql)) {
      const rowCount = await client.$executeRawUnsafe(sql, ...values);
      return { rows: [], rowCount };
    }
    const result = await client.$queryRawUnsafe<Row[]>(sql, ...values);
    const rows = Array.isArray(result) ? result : [];
    return { rows, rowCount: rows.length };
  } };
}
const iso = (value: Date | string | null) => value ? new Date(value).toISOString() : null;
/** Agent v3 失败或被停止的轮次可以原样或修改后重新执行 */
const isRetryable = (run: Run) => ["failed", "stopped"].includes(run.status) && run.input.engine === 3;
const preparationKinds = ["model.chat", "model.title", "canvas.read", "canvas.focus", "generation.read", "generation.models", "model.guidance", "creative.method", "skillOperator", "project.read", "project.progress", "artifact.review", "history.read", "media.inspect", "user.ask", "generation.requirements", "generation.plan"];
// Only the server edit transaction establishes a new input version. Worker
// reclaim/pause/resume epochs must keep this boundary so unknown calls cannot replay.
const messageRevisionStartEpoch = (run: Run) => {
  const start = run.input.revisionStartEpoch;
  return start !== undefined && Number.isSafeInteger(start) && start > 0 && start <= run.epoch && (run.input.revision ?? 0) > 0 ? start : 0;
};
const mapRun = (r: Row): Run => ({ id: r.id, sessionId: r.session_id, actorUserId: Number(r.actor_user_id), canvasId: Number(r.canvas_id), status: r.status, epoch: Number(r.epoch), error: r.error, createdAt: iso(r.created_at)!, updatedAt: iso(r.updated_at)!, leaseExpiresAt: iso(r.lease_expires_at), workerId: r.worker_id, input: r.input });
const mapMessage = (r: Row): Message => ({ id: r.id, role: r.role, text: r.text, createdAt: iso(r.created_at)!, runId: r.run_id, ...(r.role === "user" && r.selected_skill_id ? { selectedSkillId: r.selected_skill_id } : {}), ...(r.reference_data ? { references: r.reference_data } : {}), ...(r.thinking ? { thinking: r.thinking } : {}) });
const mapAction = (r: Row, claimed = false): Action => ({ id: r.id, actionId: r.id, runId: r.run_id, actorUserId: Number(r.actor_user_id), canvasId: Number(r.canvas_id), epoch: Number(r.epoch), kind: r.kind, inputHash: r.input_hash, state: r.state, result: r.result, claimed });
const mapDecision = (r: Row): Decision => ({ id: r.id, runId: r.run_id, actionId: r.action_id, proposalHash: r.proposal_hash, title: r.title, question: r.question, options: r.options, ...(r.fields?.length ? { fields: r.fields } : {}), state: r.state, answer: r.answer, ...(r.binding ? { binding: r.binding } : {}), ...(r.media ? { media: r.media } : {}) });

// Match persisted dispatch evidence, including a lost response after a paid submission.
const mediaReceiptJoin = `FROM "CreativeAgentRun" r JOIN "CreativeAgentAction" a ON a.run_id=r.id
  JOIN "Generation" g ON g."authUserId"=r.actor_user_id AND g."canvasId"=r.canvas_id AND g.source='agent'
    AND (a.result->'generationIds' @> jsonb_build_array(g.id) OR a.result->>'generationId'=g.id::text
      OR a.result#>'{mediaDispatch,requestKeys}' ? g."requestKey"::text OR a.result->'requestKeys' ? g."requestKey"::text)
  WHERE a.kind IN ('image.generate','video.generate')`;
const unsettledMedia = `AND NOT EXISTS (SELECT 1 FROM "CreativeAgentEvent" e WHERE e.run_id=r.id AND e.type='media.updated'
  AND e.payload->>'generationId'=g.id::text AND e.payload->>'status' IN ('success','failed','cancelled','canceled'))`;

const sessionSummarySql = `SELECT s.*,
  (SELECT count(*)::integer FROM "CreativeAgentMessage" m WHERE m.session_id=s.id) AS message_count,
  (SELECT m.id FROM "CreativeAgentMessage" m WHERE m.session_id=s.id ORDER BY m.created_at DESC,m.id DESC LIMIT 1) AS last_message_id
  FROM "CreativeAgentSession" s`;
const mapSession = (r: Row): CreativeAgentSessionSummary => ({ activeSkillId: r.creation_context?.skillId ?? null, id: r.id, title: r.title, titleSource: r.title_source, titleMessageId: r.title_message_id, lastMessageId: r.last_message_id ?? null, messageCount: Number(r.message_count ?? 0), createdAt: iso(r.created_at)!, updatedAt: iso(r.updated_at)! });

export class CreativeAgentStore {
  private pool: DB;
  constructor(private client: PrismaClient = prisma) { this.pool = adapter(client); }
  async transaction<T>(fn: (client: DB) => Promise<T>): Promise<T> {
    return this.client.$transaction(tx => fn(adapter(tx)), { maxWait: 5000, timeout: 15000 });
  }
  async saveGenerationPlan(run: Run, id: string, plan: GenerationPlan) {
    return this.transaction(async db => {
      const current = await this.lockedRun(db, run.id, run.actorUserId); this.fence(current, run.epoch);
      if (current.canvasId !== run.canvasId || current.input.matchingPolicyVersion !== 2) throw new CreativeAgentError("RUN_SCOPE_INVALID", "方案不属于当前运行");
      const previous = current.input.generationPlans?.[id];
      if (previous) {
        if (hash(previous.plan) !== hash(plan)) throw new CreativeAgentError("PLAN_IMMUTABLE", "已保存方案不能覆盖，请准备新版本", 409);
        return previous;
      }
      if (plan.requirementsRevision !== (current.input.requirements?.revision ?? 0)) throw new CreativeAgentError("SELECTION_RECEIPT_STALE", "需求版本已经变化", 409);
      await this.applyConversationSubject(db, current, plan.definition.subject, plan.definition.steps.flatMap(step => step.references.filter(ref => "nodeId" in ref)), plan.steps.flatMap(step => step.receipt ? [step.receipt] : []));
      const saved = { id, plan: structuredClone(plan), expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() };
      await db.query('UPDATE "CreativeAgentRun" SET input=$2::jsonb WHERE id=$1', [run.id, JSON.stringify({ ...current.input, generationPlans: { ...current.input.generationPlans, [id]: saved } })]);
      return saved;
    });
  }
  async reserveGenerationStep(run: Run, request: GenerationReservationInput) {
    return this.transaction(async db => {
      const current = await this.lockedRun(db, run.id, run.actorUserId); this.fence(current, run.epoch);
      if (current.canvasId !== run.canvasId) throw new CreativeAgentError("RUN_SCOPE_INVALID", "数量预留不属于当前画布");
      const input = reserveGenerationQuantity(current.input, request);
      await db.query('UPDATE "CreativeAgentRun" SET input=$2::jsonb WHERE id=$1', [run.id, JSON.stringify(input)]);
      return input.quantityLedger!;
    });
  }
  async transitionGenerationStep(run: Pick<Run, "id" | "epoch" | "actorUserId" | "canvasId">, requestKey: string, phase: "started" | "released") {
    return this.transaction(async db => {
      const current = await this.lockedRun(db, run.id, run.actorUserId); this.fence(current, run.epoch);
      if (current.canvasId !== run.canvasId) throw new CreativeAgentError("RUN_SCOPE_INVALID", "数量预留不属于当前画布");
      const input = transitionGenerationReservation(current.input, requestKey, phase);
      await db.query('UPDATE "CreativeAgentRun" SET input=$2::jsonb WHERE id=$1', [run.id, JSON.stringify(input)]);
    });
  }
  /** Observing already-produced assets is allowed after pause; it cannot dispatch work. */
  async observeGenerationOutput(run: Pick<Run, "id" | "actorUserId" | "canvasId">, requestKey: string, observation: GenerationObservation) {
    return this.transaction(async db => {
      const current = await this.lockedRun(db, run.id, run.actorUserId);
      if (current.canvasId !== run.canvasId) throw new CreativeAgentError("RUN_SCOPE_INVALID", "结果不属于当前画布");
      const input = observeGenerationQuantity(current.input, requestKey, observation);
      await db.query('UPDATE "CreativeAgentRun" SET input=$2::jsonb WHERE id=$1', [run.id, JSON.stringify(input)]);
      return input.quantityLedger;
    });
  }
  async health() { await this.pool.query('SELECT 1 FROM "CreativeAgentSession" LIMIT 1'); }
  private async event(db: DB, runId: string, type: EventType, payload: Record<string, unknown>) {
    await db.query("INSERT INTO \"CreativeAgentEvent\"(run_id,type,payload) VALUES($1,$2,$3::jsonb)", [runId, type, JSON.stringify(payload)]);
  }
  private async lockedRun(db: DB, runId: string, actorUserId?: number): Promise<Run> {
    const { rows } = await db.query("SELECT * FROM \"CreativeAgentRun\" WHERE id=$1 FOR UPDATE", [runId]);
    if (!rows[0] || (actorUserId !== undefined && rows[0].actor_user_id !== actorUserId)) throw new HttpError(404, "run_not_found", "Run not found");
    return mapRun(rows[0]);
  }
  private fence(run: Run, epoch: number) {
    if (run.epoch !== epoch || !["running", "waiting_decision", "waiting_action"].includes(run.status) || !run.leaseExpiresAt || Date.parse(run.leaseExpiresAt) <= Date.now()) throw new HttpError(409, "stale_epoch", "Run lease is no longer active");
  }
  async getRun(runId: string, actorUserId?: number): Promise<Run> {
    const { rows } = await this.pool.query("SELECT * FROM \"CreativeAgentRun\" WHERE id=$1", [runId]);
    if (!rows[0] || (actorUserId !== undefined && rows[0].actor_user_id !== actorUserId)) throw new HttpError(404, "run_not_found", "Run not found");
    return mapRun(rows[0]);
  }
  async assertFence(runId: string, epoch: number): Promise<Run> { const run = await this.getRun(runId); this.fence(run, epoch); return run; }
  async findSubmission(input: MessageInput) {
    const inputHash = hash({ actorUserId: input.actorUserId, canvasId: input.canvasId, sessionId: input.sessionId ?? null, text: input.text, baseRevision: input.baseRevision, selection: input.selection, model: input.model, thinkingLevel: input.thinkingLevel, attachments: input.attachments, preferences: input.preferences, selectedSkillId: input.selectedSkillId, referenceMode: input.referenceMode });
    const prior = await this.pool.query("SELECT m.*,s.actor_user_id,s.canvas_id FROM \"CreativeAgentMessage\" m JOIN \"CreativeAgentSession\" s ON s.id=m.session_id WHERE m.id=$1", [input.messageId]);
    const row = prior.rows[0];
    if (!row) return null;
    if (row.actor_user_id !== input.actorUserId || Number(row.canvas_id) !== input.canvasId || row.input_hash !== inputHash || (input.sessionId && input.sessionId !== row.session_id)) throw new HttpError(409, "message_id_conflict", "Message ID was already used for a different request");
    return { sessionId: row.session_id as string, run: await this.getRun(row.run_id, input.actorUserId), message: mapMessage(row), duplicate: true };
  }
  async enqueue(input: MessageInput): Promise<{ sessionId: string; run: Run; message: Message; duplicate: boolean }> {
    const inputHash = hash({ actorUserId: input.actorUserId, canvasId: input.canvasId, sessionId: input.sessionId ?? null, text: input.text, baseRevision: input.baseRevision, selection: input.selection, model: input.model, thinkingLevel: input.thinkingLevel, attachments: input.attachments, preferences: input.preferences, selectedSkillId: input.selectedSkillId, referenceMode: input.referenceMode });
    return this.transaction(async client => {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))::text", [`creative-agent:canvas:${input.canvasId}`]);
      const prior = await client.query("SELECT m.*,s.actor_user_id,s.canvas_id FROM \"CreativeAgentMessage\" m JOIN \"CreativeAgentSession\" s ON s.id=m.session_id WHERE m.id=$1", [input.messageId]);
      if (prior.rows[0]) {
        const row = prior.rows[0];
        if (row.actor_user_id !== input.actorUserId || Number(row.canvas_id) !== input.canvasId || row.input_hash !== inputHash || (input.sessionId && input.sessionId !== row.session_id)) throw new HttpError(409, "message_id_conflict", "Message ID was already used for a different request");
        return { sessionId: row.session_id, run: await this.lockedRun(client, row.run_id), message: mapMessage(row), duplicate: true };
      }
      await assertDurableWorkAdmission();
      const active = await client.query("SELECT id FROM \"CreativeAgentRun\" WHERE canvas_id=$1 AND status NOT IN ('completed','stopped','failed') LIMIT 1", [input.canvasId]);
      if (active.rowCount) throw new HttpError(409, "canvas_busy", "此画布已有未结束的对话，请先停止该对话或等待完成后再发送");
      let sessionId: string;
      if (input.sessionId) {
        const session = await client.query("SELECT id FROM \"CreativeAgentSession\" WHERE id=$1 AND actor_user_id=$2 AND canvas_id=$3", [input.sessionId, input.actorUserId, input.canvasId]);
        if (!session.rows[0]) throw new HttpError(404, "session_not_found", "Session not found");
        sessionId = session.rows[0].id;
      } else {
        let session = await client.query('SELECT id FROM "CreativeAgentSession" WHERE actor_user_id=$1 AND canvas_id=$2 ORDER BY updated_at DESC,created_at DESC,id DESC LIMIT 1', [input.actorUserId, input.canvasId]);
        if (!session.rows[0]) session = await client.query('INSERT INTO "CreativeAgentSession"(id,actor_user_id,canvas_id,creation_context) VALUES($1,$2,$3,\'{"version":1,"skillId":null,"referenceAnchor":null,"latestRequestActionId":null}\'::jsonb) RETURNING id', [randomUUID(), input.actorUserId, input.canvasId]);
        sessionId = session.rows[0].id;
      }
      const runId = randomUUID();
      const previousContext = await this.conversationContext(client, input.actorUserId, input.canvasId, sessionId);
      const conversationContext = { ...previousContext, skillId: resolveConversationSkill(input.text, input.selectedSkillId, previousContext) };
      const selection = input.resolvedSelection ?? input.selection;
      const mediaReferences = selection.references.filter(isConversationMediaReference);
      if (input.referenceMode === "clear") {
        if (selection.references.length || input.attachments?.length) throw new HttpError(400, "reference_selection_conflict", "清除参考图时不能同时选择素材");
        conversationContext.referenceAnchor = null; conversationContext.latestRequestActionId = null;
      } else if (mediaReferences.length) {
        const references = [...new Map((input.referenceMode === "combine" ? [...(previousContext.referenceAnchor?.references ?? []), ...mediaReferences] : mediaReferences).map(ref => [hash(mediaReference(ref)), ref])).values()];
        if (!sameConversationReferences(references, previousContext.referenceAnchor?.references ?? [])) {
          conversationContext.referenceAnchor = { runId, messageId: input.messageId, references, ...(input.referenceMode === "combine" && previousContext.referenceAnchor?.referenceVersions ? { referenceVersions: previousContext.referenceAnchor.referenceVersions } : {}) };
        }
      }
      await client.query('UPDATE "CreativeAgentSession" SET creation_context=$2::jsonb WHERE id=$1', [sessionId, JSON.stringify(conversationContext)]);
      const runResult = await client.query("INSERT INTO \"CreativeAgentRun\"(id,session_id,actor_user_id,canvas_id,status,input) VALUES($1,$2,$3,$4,'queued',$5::jsonb) RETURNING *", [runId, sessionId, input.actorUserId, input.canvasId, JSON.stringify({ ...input, engine: 3, conversationContext, modelFrontiers: undefined, mediaAuthorizationVersion: 1, matchingPolicyVersion: 2, effectivePreferences: newMatchingPreferences(input.preferences), selection: input.resolvedSelection ?? input.selection })]);
      const message = await client.query("INSERT INTO \"CreativeAgentMessage\"(id,session_id,run_id,role,text,reference_data,input_hash) VALUES($1,$2,$3,'user',$4,$5::jsonb,$6) RETURNING *", [input.messageId, sessionId, runId, input.text, JSON.stringify((input.resolvedSelection ?? input.selection).references), inputHash]);
      await client.query(`UPDATE "CreativeAgentSession" SET updated_at=now(),title=CASE WHEN title_source='auto' AND title='新对话' THEN '创作对话' ELSE title END WHERE id=$1`, [sessionId]);
      message.rows[0].selected_skill_id = conversationContext.skillId;
      await this.event(client, runId, "message.completed", { message: mapMessage(message.rows[0]) });
      await this.event(client, runId, "run.status", { status: "queued" });
      return { sessionId, run: mapRun(runResult.rows[0]), message: mapMessage(message.rows[0]), duplicate: false };
    }).then(result => { wakeCreativeAgentWorker(); return result; });
  }
  async snapshot(actorUserId: number, canvasId: number, sessionId?: string) {
    return this.transaction(async client => {
      await client.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
      const session = (await client.query(`${sessionSummarySql} WHERE s.actor_user_id=$1 AND s.canvas_id=$2 ${sessionId ? "AND s.id=$3" : "ORDER BY s.updated_at DESC,s.created_at DESC,s.id DESC LIMIT 1"}`, sessionId ? [actorUserId, canvasId, sessionId] : [actorUserId, canvasId])).rows[0];
      if (!session && sessionId) throw new HttpError(404, "session_not_found", "对话不存在");
      if (!session) return { session: null, sessionId: null, messages: [], run: null, latestSequence: 0, media: [], mediaPending: false, finishedAtByRun: {}, usage: summarizeCreativeAgentUsage([]), usageScopes: { currentRun: summarizeLlmAttempts([]), currentBranch: summarizeCreativeAgentUsage([]), allAttempts: summarizeLlmAttempts([]) } };
      const messages = (await client.query(`SELECT m.*, (SELECT r.input#>>'{conversationContext,skillId}' FROM "CreativeAgentRun" r WHERE r.id=m.run_id) AS selected_skill_id, (SELECT e.payload->'message'->'thinking' FROM "CreativeAgentEvent" e WHERE e.run_id=m.run_id AND e.type='message.completed' AND e.payload->'message'->>'id'=m.id ORDER BY e.sequence DESC LIMIT 1) AS thinking FROM "CreativeAgentMessage" m WHERE m.session_id=$1 ORDER BY m.created_at,m.id`, [session.id])).rows.map(mapMessage);
      // Keep completed process cards on reload, without replaying token deltas or exposing model receipts.
      const activityRows = (await client.query(`SELECT * FROM (
        SELECT DISTINCT ON (e.run_id,e.payload->>'actionId') e.*,
          (SELECT min(first_event.created_at) FROM "CreativeAgentEvent" first_event WHERE first_event.run_id=e.run_id AND first_event.type='tool.started' AND first_event.payload->>'actionId'=e.payload->>'actionId') AS started_at,
          (SELECT min(first_event.sequence) FROM "CreativeAgentEvent" first_event WHERE first_event.run_id=e.run_id AND first_event.type='tool.started' AND first_event.payload->>'actionId'=e.payload->>'actionId') AS started_sequence,
          r.session_id,r.canvas_id,r.status,r.error,r.created_at AS run_created_at,r.updated_at AS run_updated_at
        FROM "CreativeAgentEvent" e JOIN "CreativeAgentRun" r ON r.id=e.run_id
        WHERE r.session_id=$1 AND e.type IN ('tool.started','tool.completed') AND e.payload ? 'actionId'
          AND e.sequence>COALESCE((SELECT max(revision.sequence) FROM "CreativeAgentEvent" revision WHERE revision.run_id=r.id AND revision.type='message.revised'),0)
        ORDER BY e.run_id,e.payload->>'actionId',e.sequence DESC
      ) recent ORDER BY sequence DESC LIMIT 600`, [session.id])).rows.reverse();
      const activity = activityRows.map(row => ({ event: { sequence: Number(row.sequence), runId: row.run_id, type: row.type as EventType, payload: { ...row.payload, startedSequence:Number(row.started_sequence ?? row.sequence), ...(row.payload.detail && typeof row.payload.detail === "object" ? { detail: creativeToolPresentation(row.payload.name || "", { ...row.payload.detail, ...(row.payload.status === "error" || row.payload.status === "failed" ? { status: row.payload.status } : {}) }) } : {}) }, createdAt: iso(row.started_at || row.created_at)! }, run: { id: row.run_id, sessionId: row.session_id, canvasId: Number(row.canvas_id), status: row.status, error: row.error, createdAt: iso(row.run_created_at)!, updatedAt: iso(row.run_updated_at)! } }));
      const lastRun = (await client.query("SELECT * FROM \"CreativeAgentRun\" WHERE session_id=$1 ORDER BY created_at DESC LIMIT 1", [session.id])).rows[0];
      const finishedAtByRun = Object.fromEntries((await client.query(`SELECT id,updated_at FROM "CreativeAgentRun" WHERE actor_user_id=$2 AND canvas_id=$3 AND status IN ('completed','failed','stopped')
        AND (session_id=$1 OR id IN (SELECT run_id FROM "CreativeAgentMessage" WHERE session_id=$1))`, [session.id, actorUserId, canvasId])).rows.map(row => [row.id, iso(row.updated_at)!]));
      const latest = lastRun ? await client.query("SELECT COALESCE(max(sequence),0)::text AS sequence FROM \"CreativeAgentEvent\" WHERE run_id=$1", [lastRun.id]) : null;
      return { session: mapSession(session), sessionId: session.id, messages, activity, finishedAtByRun, editableMessageId: await this.editableMessage(lastRun ? mapRun(lastRun) : null, client), ...await this.mediaState(session.id, client), usage: summarizeCreativeAgentUsage(session.transcript ?? []), usageScopes: await this.usageScopes(session.id, lastRun?.id, session.transcript ?? [], client), run: lastRun ? mapRun(lastRun) : null, latestSequence: Number(latest?.rows[0]?.sequence ?? 0) };
    });
  }
  async listSessions(actorUserId: number, canvasId: number) {
    return (await this.pool.query(`${sessionSummarySql} WHERE s.actor_user_id=$1 AND s.canvas_id=$2 ORDER BY s.updated_at DESC,s.created_at DESC,s.id DESC`, [actorUserId, canvasId])).rows.map(mapSession);
  }
  async getSession(actorUserId: number, canvasId: number, sessionId: string) {
    const row = (await this.pool.query(`${sessionSummarySql} WHERE s.id=$1 AND s.actor_user_id=$2 AND s.canvas_id=$3`, [sessionId, actorUserId, canvasId])).rows[0];
    if (!row) throw new HttpError(404, "session_not_found", "对话不存在");
    return mapSession(row);
  }
  async createSession(actorUserId: number, canvasId: number, sessionId: string) {
    await this.pool.query('INSERT INTO "CreativeAgentSession"(id,actor_user_id,canvas_id,creation_context) VALUES($1,$2,$3,\'{"version":1,"skillId":null,"referenceAnchor":null,"latestRequestActionId":null}\'::jsonb) ON CONFLICT(id) DO NOTHING', [sessionId, actorUserId, canvasId]);
    return this.getSession(actorUserId, canvasId, sessionId);
  }
  async renameSession(actorUserId: number, canvasId: number, sessionId: string, title: string) {
    const result = await this.pool.query(`UPDATE "CreativeAgentSession" SET title=$4,title_source='manual',title_claim_id=NULL,updated_at=now() WHERE id=$1 AND actor_user_id=$2 AND canvas_id=$3 RETURNING id`, [sessionId, actorUserId, canvasId, title]);
    if (!result.rowCount) throw new HttpError(404, "session_not_found", "对话不存在");
    return this.getSession(actorUserId, canvasId, sessionId);
  }
  async claimSessionTitle(actorUserId: number, canvasId: number, sessionId: string) {
    return this.transaction(async db => {
      const session = (await db.query('SELECT * FROM "CreativeAgentSession" WHERE id=$1 AND actor_user_id=$2 AND canvas_id=$3 FOR UPDATE', [sessionId, actorUserId, canvasId])).rows[0];
      if (!session) throw new HttpError(404, "session_not_found", "对话不存在");
      if (session.title_source === "manual" || session.title_attempt_message_id) return null;
      // A successful no-topic response can try again only after a new user message.
      // Failures and uncertain dispatches keep their durable marker and never retry.
      const latest = (await db.query(`SELECT id,run_id FROM "CreativeAgentMessage" WHERE session_id=$1 AND role='user' ORDER BY created_at DESC,id DESC LIMIT 1`, [sessionId])).rows[0];
      if (!latest || session.title_message_id === latest.id) return null;
      const claimId = randomUUID();
      await db.query('UPDATE "CreativeAgentSession" SET title_attempt_message_id=$2,title_claim_id=$3 WHERE id=$1', [sessionId, latest.id, claimId]);
      const history = (await db.query(`SELECT role,left(text,2000) AS text FROM (SELECT role,text,created_at,id FROM "CreativeAgentMessage" WHERE session_id=$1 AND role IN ('user','assistant') AND ($2::text IS NULL OR (created_at,id)>(SELECT created_at,id FROM "CreativeAgentMessage" WHERE id=$2)) ORDER BY created_at,id LIMIT 20) recent ORDER BY created_at,id`, [sessionId, session.title_message_id])).rows;
      return { claimId, runId: latest.run_id as string, messageId: latest.id as string, history: history.map(row => ({ role: row.role as "user" | "assistant", text: row.text as string })) };
    });
  }
  async assertSessionTitleClaim(actorUserId: number, canvasId: number, sessionId: string, claimId: string, messageId: string) {
    const result = await this.pool.query(`SELECT id FROM "CreativeAgentSession" WHERE id=$1 AND actor_user_id=$2 AND canvas_id=$3 AND title_source='auto' AND title_claim_id=$4 AND title_attempt_message_id=$5`, [sessionId, actorUserId, canvasId, claimId, messageId]);
    if (!result.rowCount) throw new HttpError(409, "title_claim_stale", "标题任务已失效");
  }
  async finishSessionTitle(sessionId: string, claimId: string, messageId: string, title: string) {
    await this.pool.query(`UPDATE "CreativeAgentSession" s SET title=$4,title_message_id=$3,title_claim_id=NULL,title_attempt_message_id=CASE WHEN $4='创作对话' THEN NULL ELSE title_attempt_message_id END,updated_at=now()
      WHERE id=$1 AND title_claim_id=$2 AND title_source='auto' AND title_attempt_message_id=$3
`, [sessionId, claimId, messageId, title]);
  }
  async events(runId: string, actorUserId: number, after: number) {
    const run = await this.getRun(runId, actorUserId);
    const { rows } = await this.pool.query(`SELECT * FROM "CreativeAgentEvent" WHERE run_id=$1 AND sequence>$2
      AND sequence>=COALESCE((SELECT max(sequence) FROM "CreativeAgentEvent" WHERE run_id=$1 AND type='message.revised'),0) ORDER BY sequence LIMIT 500`, [runId, after]);
    const events: Event[] = rows.map(row => ({ sequence: Number(row.sequence), runId, type: row.type, payload: row.payload, createdAt: iso(row.created_at)! }));
    return { events, nextSequence: events.at(-1)?.sequence ?? after, run, editableMessageId: await this.editableMessage(run), ...await this.mediaState(run.sessionId) };
  }
  private async editableMessage(run: Run | null, db = this.pool): Promise<string | null> {
    if (!run) return null;
    // Agent v3：失败或被停止的最新一轮可以修改提问后重新执行（与“重新执行”同一机制，已产生的素材保留在画布上）
    const ended = isRetryable(run);
    if (!ended && !["queued", "running", "waiting_decision", "paused"].includes(run.status)) return null;
    const { rows } = await db.query(`SELECT m.id FROM "CreativeAgentMessage" m WHERE m.session_id=$1 AND m.run_id=$2 AND m.role='user'
      AND NOT EXISTS (SELECT 1 FROM "CreativeAgentMessage" newer WHERE newer.session_id=m.session_id AND newer.role='user' AND (newer.created_at,newer.id)>(m.created_at,m.id))
      AND ($4 OR NOT EXISTS (SELECT 1 FROM "CreativeAgentAction" a WHERE a.run_id=$2 AND NOT (a.kind=ANY($3::text[])))) LIMIT 1`, [run.sessionId, run.id, preparationKinds, ended]);
    return rows[0]?.id ?? null;
  }
  async reviseMessage(actorUserId: number, canvasId: number, input: CreativeAgentMessageRevision) {
    return this.transaction(async db => {
      const run = await this.lockedRun(db, input.runId, actorUserId);
      if (run.canvasId !== canvasId) throw new HttpError(404, "run_not_found", "对话不存在");
      const inputHash = hash({ actorUserId, canvasId, ...input });
      const previous = (await db.query('SELECT * FROM "CreativeAgentRequest" WHERE id=$1', [input.requestId])).rows[0];
      if (previous) {
        if (previous.actor_user_id !== actorUserId || previous.input_hash !== inputHash) throw new HttpError(409, "request_id_conflict", "修改请求已变化，请重新提交");
        return previous.result;
      }
      if (await this.editableMessage(run, db) !== input.messageId) throw new HttpError(409, "message_edit_closed", "任务已进入执行阶段或结束，不能修改原提问，请发送新的要求。");
      if (run.input.text !== input.expectedText) throw new HttpError(409, "message_edit_conflict", "这条提问已在其他页面修改，请刷新后查看。");
      await assertDurableWorkAdmission();
      const transcript = (await db.query('SELECT transcript FROM "CreativeAgentSession" WHERE id=$1 FOR UPDATE', [run.sessionId])).rows[0]?.transcript ?? [];
      const turn = transcript.findIndex((message: { role?: string; timestamp?: number }) => message.role === "user" && message.timestamp === Date.parse(run.createdAt));
      const history = turn < 0 ? transcript : transcript.slice(0, turn);
      const conversationContext = run.input.conversationContext ? { ...run.input.conversationContext, skillId: resolveConversationSkill(input.text, undefined, run.input.conversationContext) } : undefined;
      await this.abandonClaimed(db, run);
      const revised = { ...run.input, ...(conversationContext ? { conversationContext } : {}), text: input.text, revision: (run.input.revision ?? 0) + 1, revisionStartEpoch: run.epoch + 1, actionRevision: undefined, ...(run.input.matchingPolicyVersion === 2 ? { effectivePreferences: newMatchingPreferences(run.input.preferences), requirements: undefined } : {}) };
      if (conversationContext) await db.query('UPDATE "CreativeAgentSession" SET creation_context=$2::jsonb WHERE id=$1', [run.sessionId, JSON.stringify(conversationContext)]);
      // Locking the same run as claimAction makes revision and the first mutation exclusive.
      // Bumping the lease epoch fences any old model response or tool still in flight.
      await db.query(`UPDATE "CreativeAgentRun" SET input=$2::jsonb,status='queued',epoch=epoch+1,worker_id=NULL,lease_expires_at=NULL,error=NULL,updated_at=now() WHERE id=$1`, [run.id, JSON.stringify(revised)]);
      await db.query('UPDATE "CreativeAgentDecision" SET state=\'cancelled\' WHERE run_id=$1', [run.id]);
      await db.query('UPDATE "CreativeAgentSession" SET transcript=$2::jsonb,title_claim_id=CASE WHEN title_attempt_message_id=$3 THEN NULL ELSE title_claim_id END,updated_at=now() WHERE id=$1', [run.sessionId, JSON.stringify(history), input.messageId]);
      // The event journal retains old replies; only the current visible attempt is replaced.
      await db.query('DELETE FROM "CreativeAgentMessage" WHERE session_id=$1 AND run_id=$2 AND role=\'assistant\'', [run.sessionId, run.id]);
      const { rows } = await db.query('UPDATE "CreativeAgentMessage" SET text=$2,input_hash=$3 WHERE id=$1 AND session_id=$4 RETURNING *', [input.messageId, input.text, hash(revised), run.sessionId]);
      await this.event(db, run.id, "message.revised", { message: mapMessage(rows[0]), usage: summarizeCreativeAgentUsage(history) });
      await this.event(db, run.id, "run.status", { status: "queued" });
      const result = { sessionId: run.sessionId, runId: run.id };
      await db.query('INSERT INTO "CreativeAgentRequest"(id,actor_user_id,input_hash,result,run_id) VALUES($1,$2,$3,$4::jsonb,$5)', [input.requestId, actorUserId, inputHash, JSON.stringify(result), run.id]);
      return result;
    }).then(result => { wakeCreativeAgentWorker(); return result; });
  }
  async pendingMediaDeliveries(cursor?: { runId: string; generationId: number }): Promise<{ run: Run; generationId: number }[]> {
    const { rows } = await this.pool.query(`SELECT DISTINCT r.*,g.id AS generation_id ${mediaReceiptJoin} ${unsettledMedia}
      ${cursor ? "AND (r.id,g.id)>($1::text,$2::int)" : ""}
      ORDER BY r.id,g.id LIMIT 24`, cursor ? [cursor.runId, cursor.generationId] : []);
    return rows.map(row => ({ run: mapRun(row), generationId: Number(row.generation_id) }));
  }
  async assertMediaDelivery(run: Run, generationId: number) {
    const { rowCount } = await this.pool.query(`SELECT g.id ${mediaReceiptJoin}
      AND r.id=$1 AND r.actor_user_id=$2 AND r.canvas_id=$3 AND g.id=$4 LIMIT 1`, [run.id, run.actorUserId, run.canvasId, generationId]);
    if (!rowCount) throw new HttpError(404, "media_receipt_not_found", "生成任务不属于本次对话");
  }
  private async mediaState(sessionId: string, db = this.pool): Promise<{ media: CreativeAgentMedia[]; mediaPending: boolean }> {
    const { rows } = await db.query(`SELECT DISTINCT ON (e.payload->>'generationId') e.payload,e.created_at,e.run_id,r.status AS run_status,
      (SELECT review.payload FROM "CreativeAgentEvent" review WHERE review.run_id=e.run_id AND review.type='media.review' ORDER BY review.sequence DESC LIMIT 1) AS review
      FROM "CreativeAgentEvent" e JOIN "CreativeAgentRun" r ON r.id=e.run_id WHERE r.session_id=$1 AND e.type='media.updated'
      AND e.sequence>COALESCE((SELECT max(revision.sequence) FROM "CreativeAgentEvent" revision WHERE revision.run_id=e.run_id AND revision.type='message.revised'),0)
      ORDER BY e.payload->>'generationId',e.sequence DESC`, [sessionId]);
    const pending = await db.query(`SELECT g.id ${mediaReceiptJoin} ${unsettledMedia} AND r.session_id=$1 LIMIT 1`, [sessionId]);
    const unknown = pending.rowCount ? { rowCount: 0 } : await db.query(`SELECT a.id FROM "CreativeAgentAction" a
      JOIN "CreativeAgentRun" r ON r.id=a.run_id WHERE r.session_id=$1 AND a.kind IN ('image.generate','video.generate')
      AND a.state IN ('claimed','unknown') AND EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(CASE
          WHEN jsonb_typeof(a.result#>'{mediaDispatch,requestKeys}')='array' THEN a.result#>'{mediaDispatch,requestKeys}'
          WHEN jsonb_typeof(a.result->'requestKeys')='array' THEN a.result->'requestKeys' ELSE '[]'::jsonb END) AS request_key
        WHERE NOT EXISTS (SELECT 1 FROM "Generation" g WHERE g."requestKey"::text=request_key AND g."authUserId"=r.actor_user_id AND g."canvasId"=r.canvas_id AND g.source='agent')) LIMIT 1`, [sessionId]);
    return { media: rows.map(row => ({ ...row.payload, runId: row.run_id, createdAt: row.payload.createdAt || iso(row.created_at), ...(row.review ? { review: row.review.status === "running" && ["completed", "failed", "stopped", "paused"].includes(row.run_status) ? { status: "unavailable", message: "作品已保留，检查过程已中断，可继续检查。" } : row.review } : {}) })), mediaPending: pending.rowCount > 0 || unknown.rowCount > 0 };
  }
  async publishMedia(run: Run, result: Record<string, unknown>) {
    await this.assertMediaDelivery(run, Number(result.generationId));
    return this.transaction(async client => {
      const current = await this.lockedRun(client, run.id, run.actorUserId);
      if (current.canvasId !== run.canvasId) throw new HttpError(409, "media_scope_changed", "画布归属已变化");
      const retry = (await client.query(`SELECT a.result ${mediaReceiptJoin}
        AND r.id=$1 AND r.actor_user_id=$2 AND r.canvas_id=$3 AND g.id=$4 AND a.result->>'retryOfGenerationId' IS NOT NULL LIMIT 1`, [run.id, run.actorUserId, run.canvasId, Number(result.generationId)])).rows[0]?.result;
      const lineage = retry ? { retryOfGenerationId: retry.retryOfGenerationId, retryAttempt: retry.retryAttempt, retryReason: retry.retryReason } : {};
      const payload = { ...creativeToolPresentation("generation.read", { ...result, ...lineage }), runId: run.id, nodeIds: Array.isArray(result.nodeIds) ? result.nodeIds : [], createdAt: run.createdAt };
      const previous = (await client.query(`SELECT payload FROM "CreativeAgentEvent" WHERE run_id=$1 AND type='media.updated' AND payload->>'generationId'=$2 ORDER BY sequence DESC LIMIT 1`, [run.id, String(result.generationId)])).rows[0]?.payload;
      // A delayed read cannot regress an already delivered terminal result.
      if (previous && (["success", "failed", "cancelled", "canceled"].includes(previous.status) && previous.status !== result.status || hash(previous) === hash(payload))) return;
      await this.event(client, run.id, "media.updated", payload);
      if (typeof result.revision === "string" && Array.isArray(result.nodeIds) && result.nodeIds.length) {
        const exists = await client.query(`SELECT sequence FROM "CreativeAgentEvent" WHERE run_id=$1 AND type='canvas.committed' AND payload->>'generationId'=$2 LIMIT 1`, [run.id, String(result.generationId)]);
        if (!exists.rowCount) await this.event(client, run.id, "canvas.committed", { generationId: result.generationId, revision: result.revision, nodeIds: result.nodeIds });
      }
    });
  }
  async claimRun(workerId: string, leaseMs: number): Promise<Run | null> {
    await assertDurableWorkAdmission();
    return this.transaction(async client => {
      const next = (await client.query("SELECT id FROM \"CreativeAgentRun\" WHERE status='queued' OR (status='waiting_action' AND worker_id IS NULL AND updated_at<=now()-interval '2 seconds') ORDER BY CASE WHEN status='queued' THEN created_at ELSE updated_at END FOR UPDATE SKIP LOCKED LIMIT 1")).rows[0];
      if (!next) return null;
      const { rows } = await client.query("UPDATE \"CreativeAgentRun\" SET status='running',epoch=epoch+1,worker_id=$2,lease_expires_at=now()+($3::double precision*interval '1 millisecond'),updated_at=now(),error=NULL WHERE id=$1 RETURNING *", [next.id, workerId, leaseMs]);
      await this.event(client, next.id, "run.status", { status: "running" });
      return mapRun(rows[0]);
    });
  }
  async heartbeat(runId: string, epoch: number, workerId: string, leaseMs: number): Promise<boolean> {
    const result = await this.pool.query("UPDATE \"CreativeAgentRun\" SET lease_expires_at=now()+($4::double precision*interval '1 millisecond'),updated_at=now() WHERE id=$1 AND epoch=$2 AND worker_id=$3 AND lease_expires_at>now() AND status IN ('running','waiting_decision','waiting_action') RETURNING id", [runId, epoch, workerId, leaseMs]);
    return result.rowCount === 1;
  }
  private async abandonClaimed(db: DB, run: Run) {
    const ledger = run.input.quantityLedger;
    if (ledger) {
      const actions = (await db.query(`SELECT id FROM "CreativeAgentAction" WHERE run_id=$1 AND state='claimed'`, [run.id])).rows;
      for (const action of actions) {
        const entries = ledger.reservations.filter(item => item.actionId === action.id);
        if (!entries.length || entries.some(item => item.phase === "started")) continue;
        for (const entry of entries) entry.phase = "released";
        await db.query(`UPDATE "CreativeAgentAction" SET state='failed',result=COALESCE(result,'{}'::jsonb) || $2::jsonb,updated_at=now() WHERE id=$1`, [action.id, JSON.stringify({message:"执行中断发生在提交之前，未调用生成服务。", rejectedBeforeDispatch:true})]);
      }
      await db.query('UPDATE "CreativeAgentRun" SET input=$2::jsonb WHERE id=$1', [run.id, JSON.stringify(run.input)]);
    }
    await db.query("UPDATE \"CreativeAgentAction\" SET state='unknown',updated_at=now() WHERE run_id=$1 AND state='claimed'", [run.id]);
  }
  async recoverExpired(): Promise<number> {
    return this.transaction(async client => {
      const { rows } = await client.query("SELECT * FROM \"CreativeAgentRun\" WHERE status IN ('running','waiting_decision','waiting_action','stopping') AND worker_id IS NOT NULL AND lease_expires_at<now() FOR UPDATE SKIP LOCKED");
      for (const row of rows) {
        await this.abandonClaimed(client, mapRun(row));
        await client.query("UPDATE \"CreativeAgentRun\" SET status='paused',epoch=epoch+1,worker_id=NULL,lease_expires_at=NULL,error='执行进程中断；未确认的操作不会自动重放。',updated_at=now() WHERE id=$1", [row.id]);
        await this.event(client, row.id, "run.status", { status: "paused", reason: "lease_expired" });
      }
      return rows.length;
    });
  }
  async appendEvent(runId: string, epoch: number, type: EventType, payload: Record<string, unknown>) {
    return this.transaction(async client => { const run = await this.lockedRun(client, runId); this.fence(run, epoch); await this.event(client, runId, type, payload); });
  }
  async commitGenerationEvent(runId: string, epoch: number, commit: { generationId: number; revision: string; nodeIds: string[] }) {
    return this.transaction(async client => {
      const run = await this.lockedRun(client, runId); this.fence(run, epoch);
      const existing = await client.query("SELECT sequence FROM \"CreativeAgentEvent\" WHERE run_id=$1 AND type='canvas.committed' AND payload->>'generationId'=$2 LIMIT 1", [runId, String(commit.generationId)]);
      if (!existing.rowCount) await this.event(client, runId, "canvas.committed", commit);
    });
  }
  async waitForActions(runId: string, epoch: number) {
    return this.transaction(async client => {
      const run = await this.lockedRun(client, runId); this.fence(run, epoch);
      await client.query("UPDATE \"CreativeAgentRun\" SET status='waiting_action',updated_at=now() WHERE id=$1", [runId]);
      await this.event(client, runId, "run.status", { status: "waiting_action" });
    });
  }
  /** delayMs：等待生成结果时推迟下次检查（worker 在 updated_at 之后约 2 秒才会重新领取） */
  async defer(runId: string, epoch: number, status: "waiting_decision" | "waiting_action", delayMs = 0): Promise<boolean> {
    return this.transaction(async client => {
      const run = await this.lockedRun(client, runId); this.fence(run, epoch);
      // An answer can arrive between ask() and this transaction. Keep executing
      // that already-answered call instead of parking it without a future wakeup.
      if (status === "waiting_decision" && !(await client.query("SELECT id FROM \"CreativeAgentDecision\" WHERE run_id=$1 AND state='pending' LIMIT 1", [runId])).rowCount) return false;
      await client.query("UPDATE \"CreativeAgentRun\" SET status=$2,epoch=epoch+1,worker_id=NULL,lease_expires_at=NULL,updated_at=now()+($3::double precision*interval '1 millisecond') WHERE id=$1", [runId, status, Math.max(0, Math.min(60_000, delayMs))]);
      await this.event(client, runId, "run.status", { status });
      return true;
    });
  }
  /** startedAt：消息开始输出的时间。整条回复（含工具参数）写完才落库，按开始时间排序才能排在随后的步骤前面 */
  async saveAssistant(runId: string, epoch: number, messageId: string, text: string, thinking?: CreativeAgentThinking, startedAt?: Date) {
    return this.transaction(async client => {
      const run = await this.lockedRun(client, runId); this.fence(run, epoch);
      const { rows } = await client.query("INSERT INTO \"CreativeAgentMessage\"(id,session_id,run_id,role,text,created_at) VALUES($1,$2,$3,'assistant',$4,COALESCE($5::timestamptz,now())) ON CONFLICT(id) DO NOTHING RETURNING *", [messageId, run.sessionId, runId, text, startedAt ?? null]);
      if (rows[0]) await this.event(client, runId, "message.completed", { message: { ...mapMessage(rows[0]), ...(thinking ? { thinking } : {}) } });
    });
  }
  /** Agent v3：更正已保存的助手消息（例如去掉模型在调用工具前提前写的“已完成”） */
  async reviseAssistant(runId: string, epoch: number, messageId: string, text: string) {
    return this.transaction(async client => {
      const run = await this.lockedRun(client, runId); this.fence(run, epoch);
      const { rows } = await client.query("UPDATE \"CreativeAgentMessage\" SET text=$3 WHERE id=$1 AND run_id=$2 AND role='assistant' RETURNING *", [messageId, runId, text]);
      if (rows[0]) await this.event(client, runId, "message.completed", { message: mapMessage(rows[0]) });
    });
  }
  async finish(runId: string, epoch: number, status: "completed" | "failed" | "stopped", error: string | null = null) {
    return this.transaction(async client => {
      const run = await this.lockedRun(client, runId);
      if (run.epoch !== epoch || isTerminal(run.status) || run.status === "paused" || !run.leaseExpiresAt || Date.parse(run.leaseExpiresAt) <= Date.now()) return;
      await this.abandonClaimed(client, run);
      await client.query("UPDATE \"CreativeAgentRun\" SET status=$2,error=$3,worker_id=NULL,lease_expires_at=NULL,updated_at=now() WHERE id=$1", [runId, status, error]);
      await client.query("UPDATE \"CreativeAgentDecision\" SET state='cancelled' WHERE run_id=$1 AND state='pending'", [runId]);
      if (error) await this.event(client, runId, "error", { message: error });
      await this.event(client, runId, "run.status", { status });
    });
  }
  async control(runId: string, actorUserId: number, requestId: string, action: "pause" | "stop" | "resume" | "continue", expectedEpoch?: number) {
    return this.transaction(async client => {
      const run = await this.lockedRun(client, runId, actorUserId);
      if (expectedEpoch !== undefined && run.epoch !== expectedEpoch) throw new HttpError(409, "stale_epoch", "旧执行已失效");
      const inputHash = hash({ runId, actorUserId, action });
      const previous = (await client.query("SELECT * FROM \"CreativeAgentRequest\" WHERE id=$1", [requestId])).rows[0];
      if (previous) { if (previous.actor_user_id !== actorUserId || previous.input_hash !== inputHash) throw new HttpError(409, "request_id_conflict", "Request ID conflict"); return previous.result; }
      if (action === "continue") {
        // 继续手动停止的最新一轮：保留这一轮已有的对话和步骤，从停下的地方接着做。
        // 模型调用换新版本（停止时进行中的调用结果未知，不能原样重放）；工具动作沿用原编号，已提交的生成直接复用，不会重复出图
        if (run.status !== "stopped") throw new HttpError(409, "run_not_continuable", "只有手动停止的最新一轮可以继续");
        if (!isRetryable(run)) throw new HttpError(409, "run_not_continuable", "这一轮由旧版 Agent 执行，不能继续，请重新发送要求");
        const newer = await client.query('SELECT 1 FROM "CreativeAgentMessage" WHERE session_id=$1 AND role=\'user\' AND created_at>$2::timestamptz AND run_id IS DISTINCT FROM $3 LIMIT 1', [run.sessionId, run.createdAt, run.id]);
        if (newer.rowCount) throw new HttpError(409, "run_not_continuable", "之后已经有新的对话，请直接发送新的要求");
        await assertDurableWorkAdmission();
        await this.abandonClaimed(client, run);
        const continued = { ...run.input, revision: (run.input.revision ?? 0) + 1, revisionStartEpoch: run.epoch + 1, actionRevision: run.input.actionRevision ?? run.input.revision ?? 0 };
        const { rows } = await client.query(`UPDATE "CreativeAgentRun" SET input=$2::jsonb,status='queued',epoch=epoch+1,worker_id=NULL,lease_expires_at=NULL,error=NULL,updated_at=now() WHERE id=$1 RETURNING *`, [run.id, JSON.stringify(continued)]);
        await this.event(client, run.id, "run.status", { status: "queued" });
        const result = { run: mapRun(rows[0]) };
        await client.query("INSERT INTO \"CreativeAgentRequest\"(id,actor_user_id,input_hash,result,run_id) VALUES($1,$2,$3,$4::jsonb,$5)", [requestId, actorUserId, inputHash, JSON.stringify(result), run.id]);
        return result;
      }
      if (isTerminal(run.status)) throw new HttpError(409, "run_terminal", "Run already ended");
      let status: RunStatus;
      if (action === "resume") {
        await assertDurableWorkAdmission();
        if (run.status !== "paused") throw new HttpError(409, "not_paused", "Run is not paused");
        const uncertain = await client.query("SELECT id FROM \"CreativeAgentAction\" WHERE run_id=$1 AND kind<>'model.title' AND state IN ('claimed','unknown') AND (kind<>'model.chat' OR epoch>=$2) LIMIT 1", [runId, messageRevisionStartEpoch(run)]);
        if (uncertain.rowCount) throw new HttpError(409, "action_outcome_unknown", "存在结果未确认的操作，不能自动重试；请先检查画布结果并停止此轮。");
        status = "queued";
      } else {
        status = action === "pause" ? "paused" : "stopped";
        await this.abandonClaimed(client, run);
        if (status === "stopped") await client.query("UPDATE \"CreativeAgentDecision\" SET state='cancelled' WHERE run_id=$1 AND state='pending'", [runId]);
        if (status === "stopped" && run.input.engine === 3) {
          // 停在半路的步骤标为已取消，不再一直显示进行中；继续执行时同一步骤会重新开始
          const open = await client.query(`SELECT DISTINCT ON (payload->>'actionId') type,payload FROM "CreativeAgentEvent" WHERE run_id=$1 AND type IN ('tool.started','tool.completed') AND payload ? 'actionId'
            AND sequence>COALESCE((SELECT max(sequence) FROM "CreativeAgentEvent" WHERE run_id=$1 AND type='message.revised'),0) ORDER BY payload->>'actionId',sequence DESC`, [runId]);
          for (const row of open.rows) if (row.type === "tool.started") await this.event(client, runId, "tool.completed", { actionId: row.payload.actionId, ...(row.payload.toolCallId ? { toolCallId: row.payload.toolCallId } : {}), name: row.payload.name, title: row.payload.title, status: "error", detail: { message: "已停止", cancelled: true } });
        }
      }
      const { rows } = await client.query("UPDATE \"CreativeAgentRun\" SET status=$2,epoch=epoch+1,worker_id=NULL,lease_expires_at=NULL,updated_at=now() WHERE id=$1 RETURNING *", [runId, status]);
      await this.event(client, runId, "run.status", { status });
      const result = { run: mapRun(rows[0]) };
      await client.query("INSERT INTO \"CreativeAgentRequest\"(id,actor_user_id,input_hash,result,run_id) VALUES($1,$2,$3,$4::jsonb,$5)", [requestId, actorUserId, inputHash, JSON.stringify(result), run.id]);
      return result;
    }).then(result => { wakeCreativeAgentWorker(); return result; });
  }
  async claimAction(input: { actorUserId: number; canvasId: number; runId: string; actionId: string; epoch: number; kind: string; inputHash: string; modelFrontier?: ModelFrontier; observedModelCalls?: { id: string; resultHash: string }[] }): Promise<Action> {
    return this.transaction(async client => {
      const run = await this.lockedRun(client, input.runId, input.actorUserId); this.fence(run, input.epoch);
      if (run.canvasId !== input.canvasId) throw new HttpError(403, "canvas_mismatch", "Canvas mismatch");
      let frontierKey: string | undefined;
      if (input.modelFrontier) {
        const frontier = input.modelFrontier;
        if (input.kind !== "model.chat" || frontier.version !== 1 || frontier.sessionId !== run.sessionId || frontier.messageId !== run.input.messageId || frontier.revision !== (run.input.revision ?? 0)) throw new HttpError(409, "model_frontier_invalid", "模型恢复点与当前输入不一致，请检查已保存结果。");
        frontierKey = modelFrontierHash(input, frontier);
        const binding = run.input.modelFrontiers?.[frontierKey];
        if (binding) {
          const saved = (await client.query('SELECT * FROM "CreativeAgentAction" WHERE id=$1 AND run_id=$2 FOR UPDATE', [binding.actionId, run.id])).rows[0];
          if (!saved || saved.kind !== "model.chat" || saved.input_hash !== binding.inputHash) throw new HttpError(409, "model_frontier_invalid", "模型恢复记录不完整，请检查已保存结果；不会重新调用。");
          return mapAction(saved);
        }
        const calls = (await client.query(`SELECT * FROM "CreativeAgentAction" WHERE run_id=$1 AND kind='model.chat' FOR UPDATE`, [run.id])).rows;
        const mapped = new Set(Object.values(run.input.modelFrontiers ?? {}).map(value => value.actionId));
        for (const call of calls) {
          if (Number(call.epoch) < messageRevisionStartEpoch(run)) continue;
          if (call.state === "claimed" || call.state === "unknown") throw new HttpError(409, "model_outcome_unknown", "上一笔模型调用结果尚未确认，请检查已保存结果；不会重新调用。");
          // Old body hashes cannot establish a missing transcript frontier. Only
          // an exact, already-consumed success may precede a genuinely new step.
          if (!mapped.has(call.id) && !(call.state === "succeeded" && input.observedModelCalls?.some(value => value.id === call.id && value.resultHash === hash(call.result)))) throw new HttpError(409, "model_frontier_unverified", "旧模型调用缺少可验证的恢复点，请检查已保存结果后开启新一轮；不会重新调用。");
        }
      }
      const prior = (await client.query("SELECT * FROM \"CreativeAgentAction\" WHERE id=$1 FOR UPDATE", [input.actionId])).rows[0];
      if (prior) {
        if (prior.run_id !== input.runId || prior.kind !== input.kind || prior.input_hash !== input.inputHash) throw new HttpError(409, "action_id_conflict", "Action ID/input hash conflict");
        return mapAction(prior);
      }
      const { rows } = await client.query("INSERT INTO \"CreativeAgentAction\"(id,run_id,actor_user_id,canvas_id,epoch,kind,input_hash,state) VALUES($1,$2,$3,$4,$5,$6,$7,'claimed') RETURNING *", [input.actionId, input.runId, input.actorUserId, input.canvasId, input.epoch, input.kind, input.inputHash]);
      if (frontierKey) {
        const next = { ...run.input, modelFrontiers: { ...run.input.modelFrontiers, [frontierKey]: { actionId: input.actionId, inputHash: input.inputHash } } };
        await client.query('UPDATE "CreativeAgentRun" SET input=$2::jsonb,updated_at=now() WHERE id=$1', [run.id, JSON.stringify(next)]);
      }
      return mapAction(rows[0], true);
    });
  }
  async getAction(actionId: string): Promise<Action> {
    const { rows } = await this.pool.query("SELECT * FROM \"CreativeAgentAction\" WHERE id=$1", [actionId]);
    if (!rows[0]) throw new HttpError(404, "action_not_found", "Action not found");
    return mapAction(rows[0]);
  }
  /** The existing start event binds one SDK call to its journal action. */
  async getMediaToolCallAction(run: Run, kind: string, toolCallId: string, rawArgs: Record<string, unknown>): Promise<{ action: Action; exact: boolean } | null> {
    const unverified = () => new HttpError(409, "media_recovery_unverified", "旧媒体调用的恢复身份无法准确核实，请检查已保存结果后开启新一轮；不会重新准备或提交。");
    const { rows } = await this.pool.query(`SELECT payload FROM "CreativeAgentEvent" WHERE run_id=$1 AND type='tool.started'
      AND payload->>'name'=$2 AND payload->>'toolCallId'=$3
      AND sequence>=COALESCE((SELECT max(sequence) FROM "CreativeAgentEvent" WHERE run_id=$1 AND type='message.revised'),0)`, [run.id, kind, toolCallId]);
    const starts = rows.map(row => row.payload).filter(payload => typeof payload.actionId === "string" && !payload.actionId.startsWith("ca_preflight_"));
    if (!starts.length) return null;
    if (new Set(starts.map(payload => payload.actionId)).size !== 1) throw unverified();
    const bindings = starts.filter(payload => payload.recovery !== undefined);
    if (bindings.some(payload => payload.recovery?.revision !== (run.input.revision ?? 0) || payload.recovery?.rawArgsHash !== hash(rawArgs))) throw unverified();
    const action = await this.getAction(starts[0].actionId).catch(error => { if (error instanceof HttpError && error.code === "action_not_found") return null; throw error; });
    // A start before a pending approval has not claimed or dispatched work.
    if (!action) return null;
    if (action.runId !== run.id || action.actorUserId !== run.actorUserId || action.canvasId !== run.canvasId || action.kind !== kind) throw unverified();
    return { action, exact: bindings.length > 0 };
  }
  /** Agent v3：提交前先把 requestKey 记到动作上，后台回写与“生成中”状态据此识别 */
  async recordMediaKeys(actionId: string, runId: string, requestKeys: string[]) {
    await this.pool.query(`UPDATE "CreativeAgentAction" SET result=COALESCE(result,'{}'::jsonb) || $3::jsonb,updated_at=now() WHERE id=$1 AND run_id=$2 AND state='claimed'`, [actionId, runId, JSON.stringify({ mediaDispatch: { requestKeys }, requestKeys })]);
  }
  async completeAction(actionId: string, input: { runId: string; epoch: number; state: Exclude<ActionState, "claimed">; result: unknown }): Promise<Action> {
    return this.transaction(async client => {
      const run = await this.lockedRun(client, input.runId);
      const row = (await client.query("SELECT * FROM \"CreativeAgentAction\" WHERE id=$1 AND run_id=$2 FOR UPDATE", [actionId, input.runId])).rows[0];
      if (!row) throw new HttpError(404, "action_not_found", "Action not found");
      if (row.state !== "claimed") {
        if (row.state === input.state && hash(row.result) === hash(input.result)) return mapAction(row);
        throw new HttpError(409, "action_finalized", "Action outcome already finalized; automatic replay is forbidden");
      }
      this.fence(run, input.epoch);
      if (Number(row.epoch) !== input.epoch) throw new HttpError(409, "stale_epoch", "Action epoch mismatch");
      const { rows } = await client.query("UPDATE \"CreativeAgentAction\" SET state=$2,result=$3::jsonb,updated_at=now() WHERE id=$1 RETURNING *", [actionId, input.state, JSON.stringify(input.result ?? null)]);
      if (input.state === "succeeded" && ["image.generate", "video.generate"].includes(row.kind)) await this.acceptConversationRequest(client, run, actionId, input.result);
      return mapAction(rows[0]);
    });
  }
  async savePreparedReferences(runId: string, epoch: number, selection: MessageInput["selection"], revision: string) {
    return this.transaction(async db => {
      const run = await this.lockedRun(db, runId); this.fence(run, epoch);
      const input = { ...run.input, preparedSelection: selection };
      if (input.conversationContext && run.input.attachments?.length && selection.references.some(isConversationMediaReference)) {
        const previous = input.referenceMode === "combine" ? input.conversationContext.referenceAnchor?.references ?? [] : [];
        const references = [...new Map([...previous, ...selection.references.filter(isConversationMediaReference)].map(ref => [hash(mediaReference(ref)), ref])).values()];
        if (!sameConversationReferences(references, input.conversationContext.referenceAnchor?.references ?? [])) input.conversationContext = { ...input.conversationContext, referenceAnchor: { runId: run.id, messageId: input.messageId, references, ...(input.referenceMode === "combine" && input.conversationContext.referenceAnchor?.referenceVersions ? { referenceVersions: input.conversationContext.referenceAnchor.referenceVersions } : {}) } };
        await db.query('UPDATE "CreativeAgentSession" SET creation_context=$2::jsonb WHERE id=$1 AND actor_user_id=$3 AND canvas_id=$4', [run.sessionId, JSON.stringify(input.conversationContext), run.actorUserId, run.canvasId]);
      }
      await db.query('UPDATE "CreativeAgentRun" SET input=$2::jsonb,updated_at=now() WHERE id=$1', [run.id, JSON.stringify(input)]);
      await db.query('UPDATE "CreativeAgentMessage" SET reference_data=$3::jsonb WHERE id=$1 AND run_id=$2 AND session_id=$4', [run.input.messageId, run.id, JSON.stringify(selection.references), run.sessionId]);
      await this.event(db, run.id, "canvas.committed", { revision, nodeIds: selection.nodeIds, references: selection.references });
      return { ...run, input: { ...input, selection, baseRevision: revision } };
    });
  }
  async hasSentAttachment(actorUserId: number, canvasId: number, sessionId: string, attachmentId: string): Promise<boolean> {
    const { rows } = await this.pool.query(`SELECT r.id FROM "CreativeAgentRun" r
      JOIN "CreativeAgentSession" s ON s.id=r.session_id
      WHERE s.id=$1 AND s.actor_user_id=$2 AND s.canvas_id=$3 AND r.actor_user_id=$2 AND r.canvas_id=$3
        AND r.input->'attachments' @> $4::jsonb LIMIT 1`, [sessionId, actorUserId, canvasId, JSON.stringify([{ id: attachmentId }])]);
    return rows.length > 0;
  }
  async getHistoricalAttachmentIds(run: Run): Promise<string[]> {
    const { rows } = await this.pool.query(`SELECT r.input->'attachments' AS attachments FROM "CreativeAgentRun" r
      JOIN "CreativeAgentSession" s ON s.id=r.session_id
      WHERE s.id=$1 AND s.actor_user_id=$2 AND s.canvas_id=$3 AND r.actor_user_id=$2 AND r.canvas_id=$3
        AND r.created_at<$4::timestamptz AND jsonb_array_length(COALESCE(r.input->'attachments','[]'::jsonb))>0`,
    [run.sessionId, run.actorUserId, run.canvasId, run.createdAt]);
    return [...new Set(rows.flatMap(row => Array.isArray(row.attachments) ? row.attachments.flatMap((item: { id?: unknown }) => typeof item?.id === "string" ? [item.id] : []) : []))];
  }
  /** Legacy recovery reads real user submissions once, never transcript/tool quotations. */
  private async conversationContext(db: DB, actorUserId: number, canvasId: number, sessionId: string): Promise<ConversationContext> {
    const session = (await db.query('SELECT creation_context FROM "CreativeAgentSession" WHERE id=$1 AND actor_user_id=$2 AND canvas_id=$3 FOR UPDATE', [sessionId, actorUserId, canvasId])).rows[0];
    if (!session) throw new HttpError(404, "session_not_found", "对话不存在");
    if (session.creation_context?.version === 1) return session.creation_context;
    const context = emptyConversationContext();
    const history = (await db.query(`SELECT r.id,r.input,m.id AS message_id,m.reference_data FROM "CreativeAgentRun" r JOIN "CreativeAgentMessage" m ON m.run_id=r.id AND m.session_id=r.session_id AND m.role='user'
      WHERE r.session_id=$1 AND r.actor_user_id=$2 AND r.canvas_id=$3 ORDER BY r.created_at DESC,r.id DESC`, [sessionId, actorUserId, canvasId])).rows;
    for (const row of history) {
      if (!context.skillId) context.skillId = resolveConversationSkill(row.input.text, undefined, emptyConversationContext());
      if (!context.referenceAnchor && Array.isArray(row.reference_data) && row.reference_data.some(isConversationMediaReference)) context.referenceAnchor = { runId: row.id, messageId: row.message_id, references: row.reference_data.filter(isConversationMediaReference) };
      if (context.skillId && context.referenceAnchor) break;
    }
    const latest = (await db.query(`SELECT a.id,a.result FROM "CreativeAgentAction" a JOIN "CreativeAgentRun" r ON r.id=a.run_id
      WHERE r.session_id=$1 AND r.actor_user_id=$2 AND r.canvas_id=$3 AND a.actor_user_id=$2 AND a.canvas_id=$3 AND a.state='succeeded' AND a.kind IN ('image.generate','video.generate')
      AND a.result->'selectionReceipt' IS NOT NULL AND a.result->'mediaRequest' IS NOT NULL
      AND (a.result->>'generationId' IS NOT NULL OR jsonb_array_length(COALESCE(a.result->'generationIds','[]'::jsonb))>0) ORDER BY a.created_at DESC,a.id DESC LIMIT 1`, [sessionId, actorUserId, canvasId])).rows[0];
    context.latestRequestActionId = latest?.id ?? null;
    if (context.referenceAnchor) {
      const receipts = (await db.query(`SELECT a.result->'selectionReceipt' AS receipt FROM "CreativeAgentAction" a JOIN "CreativeAgentRun" r ON r.id=a.run_id
        WHERE r.id=$1 AND r.session_id=$2 AND r.actor_user_id=$3 AND r.canvas_id=$4 AND a.actor_user_id=$3 AND a.canvas_id=$4 AND a.state='succeeded' AND a.kind IN ('image.generate','video.generate')
        AND (a.result->>'generationId' IS NOT NULL OR jsonb_array_length(COALESCE(a.result->'generationIds','[]'::jsonb))>0) ORDER BY a.created_at,a.id`, [context.referenceAnchor.runId, sessionId, actorUserId, canvasId])).rows;
      for (const row of receipts) context.referenceAnchor = anchorWithReceiptVersions(context.referenceAnchor, row.receipt);
    }
    return context;
  }
  async getConversationContext(run: Run): Promise<string> {
    const context = run.input.conversationContext;
    if (!context) return "";
    let latestRequest: unknown;
    if (context.latestRequestActionId) {
      const row = (await this.pool.query(`SELECT a.result FROM "CreativeAgentAction" a JOIN "CreativeAgentRun" r ON r.id=a.run_id
        WHERE a.id=$1 AND r.session_id=$2 AND r.actor_user_id=$3 AND r.canvas_id=$4 AND a.actor_user_id=$3 AND a.canvas_id=$4 AND a.state='succeeded' AND a.kind IN ('image.generate','video.generate')`, [context.latestRequestActionId, run.sessionId, run.actorUserId, run.canvasId])).rows[0];
      const result = row?.result;
      if (result?.selectionReceipt?.request && result.mediaRequest && (result.generationId || result.generationIds?.length)) latestRequest = { actionId: context.latestRequestActionId, receiptStatus: result.status, request: result.selectionReceipt.request };
      else throw new CreativeAgentError("CONVERSATION_CONTEXT_INVALID", "本对话最近请求记录不可核验，请检查原任务。", 409);
    }
    return `${conversationContextPolicy}\n${JSON.stringify({ skillId: context.skillId, referenceAnchor: context.referenceAnchor, ...(latestRequest ? { latestRequest } : {}) })}`;
  }
  private async applyConversationSubject(db: DB, run: Run, value: unknown, references?: Record<string, unknown>[], receipts: import("./matching").SelectionReceipt[] = []) {
    const intent = validatedSubjectIntent(run, value);
    if (!intent || !run.input.conversationContext) return;
    const selected = (run.input.preparedSelection?.references ?? run.input.selection.references).filter(isConversationMediaReference);
    const normalized = conversationMediaArgs(run, { subject: intent, ...(intent.mode === "clear" ? {} : { references: references ?? selected.map(mediaReference) }) }).references ?? [];
    const known = [...selected, ...run.input.conversationContext.referenceAnchor?.references ?? []];
    const refs = [...new Map(normalized.map(ref => {
      const original = known.find(item => item.nodeId === ref.nodeId && item.semanticHash === ref.semanticHash);
      const reference = { ...ref, canvasId: run.canvasId, label: original?.label ?? String(ref.nodeId), kind: original?.kind ?? "media" } as CreativeAgentReference;
      return [hash(mediaReference(reference)), reference] as const;
    })).values()];
    const previous = run.input.conversationContext.referenceAnchor;
    const referenceVersions = previous?.referenceVersions?.filter(version => refs.some(ref => ref.nodeId === version.nodeId && previous.references.some(old => hash(mediaReference(old)) === hash(mediaReference(ref)))));
    const context: ConversationContext = { ...run.input.conversationContext, referenceAnchor: refs.length ? { runId: run.id, messageId: run.input.messageId, references: refs, ...(referenceVersions?.length ? { referenceVersions } : {}) } : null, ...(intent.mode === "clear" ? { latestRequestActionId: null } : {}) };
    for (const receipt of receipts) context.referenceAnchor = anchorWithReceiptVersions(context.referenceAnchor, receipt);
    run.input = { ...run.input, conversationContext: context };
    await db.query('UPDATE "CreativeAgentSession" SET creation_context=$2::jsonb WHERE id=$1 AND actor_user_id=$3 AND canvas_id=$4', [run.sessionId, JSON.stringify(context), run.actorUserId, run.canvasId]);
  }
  private async acceptConversationRequest(db: DB, run: Run, actionId: string, value: unknown) {
    const result = value as Record<string, any> | null;
    if (!run.input.conversationContext || !result?.selectionReceipt?.request || !result.mediaRequest || !(result.generationId || result.generationIds?.length) || result.cancelled || result.rejectedBeforeDispatch) return;
    const context = { ...run.input.conversationContext, latestRequestActionId: actionId };
    const intent = validatedSubjectIntent(run, result.conversationSubject);
    if (intent) {
      const refs = result.selectionReceipt.request.references ?? [];
      context.referenceAnchor = refs.length ? { runId: run.id, messageId: run.input.messageId, references: refs.map((ref: any) => {
        const known = [...run.input.preparedSelection?.references ?? [], ...run.input.selection.references, ...context.referenceAnchor?.references ?? []].find(item => item.nodeId === ref.nodeId && item.semanticHash === ref.semanticHash);
        return { ...mediaReference(ref), canvasId: run.canvasId, label: known?.label ?? ref.nodeId, kind: known?.kind ?? "media" };
      }) } : null;
    }
    context.referenceAnchor = anchorWithReceiptVersions(context.referenceAnchor, result.selectionReceipt);
    await db.query('UPDATE "CreativeAgentRun" SET input=$2::jsonb WHERE id=$1', [run.id, JSON.stringify({ ...run.input, conversationContext: context })]);
    await db.query('UPDATE "CreativeAgentSession" SET creation_context=$2::jsonb WHERE id=$1 AND actor_user_id=$3 AND canvas_id=$4', [run.sessionId, JSON.stringify(context), run.actorUserId, run.canvasId]);
  }
  async getReferenceHistory(run: Run): Promise<string> {
    if (run.input.conversationContext) return this.getConversationContext(run);
    const { rows } = await this.pool.query(`SELECT m.id,m.text,m.reference_data,r.input->'attachments' AS attachments FROM "CreativeAgentMessage" m
      JOIN "CreativeAgentSession" s ON s.id=m.session_id JOIN "CreativeAgentRun" r ON r.id=m.run_id
      WHERE s.id=$1 AND s.actor_user_id=$2 AND s.canvas_id=$3 AND m.role='user'
        AND m.created_at<$4::timestamptz AND (jsonb_array_length(COALESCE(m.reference_data,'[]'::jsonb))>0
          OR jsonb_array_length(COALESCE(r.input->'attachments','[]'::jsonb))>0)
      ORDER BY m.created_at DESC,m.id DESC LIMIT 30`, [run.sessionId, run.actorUserId, run.canvasId, run.createdAt]);
    if (!rows.length) return "";
    const history = [];
    for (const row of rows) {
      const attachments = Array.isArray(row.attachments) && row.attachments.length
        ? await (await import("./attachments")).describeCreativeAgentAttachments({ actorUserId: run.actorUserId, canvasId: run.canvasId, sessionId: run.sessionId, attachments: row.attachments }) : [];
      history.push({ messageId: row.id, request: row.text.slice(0, 2000), references: row.reference_data, ...(attachments.length ? { attachments } : {}) });
    }
    return "本对话此前发送的画布引用与附件（仅供用户明确续用时按原版本读取；不是本轮自动选择，不可默认用于新生成；使用前核对节点仍存在及semanticHash。尚未映射的历史附件可用material_prepare按需准备指定attachmentIds，不要一次准备所有旧附件）：\n" + JSON.stringify(history);
  }
  /** Agent v3：本对话里生成过的画布节点（用于在画布摘要里标出【本对话】的作品） */
  async sessionNodeIds(sessionId: string): Promise<string[]> {
    const { rows } = await this.pool.query(`SELECT DISTINCT jsonb_array_elements_text(e.payload->'nodeIds') AS id FROM "CreativeAgentEvent" e JOIN "CreativeAgentRun" r ON r.id=e.run_id
      WHERE r.session_id=$1 AND e.type='media.updated' AND jsonb_typeof(e.payload->'nodeIds')='array'`, [sessionId]);
    return rows.map(row => String(row.id));
  }
  async getTranscript(sessionId: string): Promise<unknown[]> {
    return (await this.pool.query("SELECT transcript FROM \"CreativeAgentSession\" WHERE id=$1", [sessionId])).rows[0]?.transcript ?? [];
  }
  async saveTranscript(runId: string, epoch: number, messages: unknown[]) {
    return this.transaction(async client => {
      const run = await this.lockedRun(client, runId); this.fence(run, epoch);
      await client.query("UPDATE \"CreativeAgentSession\" SET transcript=$2::jsonb,updated_at=now() WHERE id=$1", [run.sessionId, JSON.stringify(messages)]);
      await this.event(client, runId, "usage.updated", { usage: summarizeCreativeAgentUsage(messages), usageScopes: await this.usageScopes(run.sessionId, run.id, messages, client) });
    });
  }
  /** Metrics are observation only: a superseded epoch may still report billed usage. */
  async saveLlmAttempt(scope: { actorUserId: number; canvasId: number; runId: string }, attempt: CreativeLlmAttempt) {
    await this.pool.query(`INSERT INTO "CreativeAgentAction"(id,run_id,actor_user_id,canvas_id,epoch,kind,input_hash,state,result)
      SELECT $1,r.id,r.actor_user_id,r.canvas_id,r.epoch,$5,$6,$8,jsonb_build_object('creativeAttempt',$7::jsonb)
      FROM "CreativeAgentRun" r WHERE r.id=$2 AND r.actor_user_id=$3 AND r.canvas_id=$4
      ON CONFLICT(id) DO UPDATE SET state=CASE WHEN "CreativeAgentAction".kind='model.title' THEN $8 ELSE "CreativeAgentAction".state END,result=COALESCE("CreativeAgentAction".result,'{}'::jsonb)||jsonb_build_object('creativeAttempt',$7::jsonb)
      WHERE "CreativeAgentAction".run_id=$2 AND "CreativeAgentAction".actor_user_id=$3 AND "CreativeAgentAction".canvas_id=$4`,
      [attempt.callId, scope.runId, scope.actorUserId, scope.canvasId, attempt.purpose === "title" ? "model.title" : "model.chat", hash(attempt.callId), JSON.stringify(attempt), attempt.purpose === "title" && attempt.status === "succeeded" ? "succeeded" : attempt.purpose === "title" && attempt.status === "failed" ? "failed" : "unknown"]);
  }
  private async usageScopes(sessionId: string, runId: string | undefined, transcript: unknown[], db = this.pool) {
    const { rows } = await db.query(`SELECT a.id,a.run_id,a.kind,a.state,a.created_at,a.result->'creativeAttempt' AS attempt,
      l.model,l."externalProvider" AS provider,
      jsonb_build_object('inputTokens',l."usageSnapshot"->'inputTokens','outputTokens',l."usageSnapshot"->'outputTokens','cachedInputTokens',l."usageSnapshot"->'cachedInputTokens','cacheCreationInputTokens',l."usageSnapshot"->'cacheCreationInputTokens','reasoningOutputTokens',l."usageSnapshot"->'reasoningOutputTokens','totalTokens',l."usageSnapshot"->'totalTokens') AS ledger_usage,
      a.result->'creativeUsage'->'reported' AS reported,
      jsonb_build_object('input',a.result->'usage'->'input','output',a.result->'usage'->'output','cacheRead',a.result->'usage'->'cacheRead','cacheWrite',a.result->'usage'->'cacheWrite') AS sdk_usage
      FROM "CreativeAgentAction" a JOIN "CreativeAgentRun" r ON r.id=a.run_id
      LEFT JOIN "UsageLedger" l ON l."requestKey"::text=a.id AND l."authUserId"=r.actor_user_id
      WHERE r.session_id=$1 AND a.kind IN ('model.chat','model.title')`, [sessionId]);
    let legacyUnverifiedCalls = 0;
    const attempts = rows.flatMap(row => {
      if (row.attempt) return [row.attempt as CreativeLlmAttempt];
      let usage = projectLlmUsage(row.ledger_usage);
      if (!Object.keys(usage).length && row.reported === true) {
        const sdk = row.sdk_usage;
        const valid = [sdk.input, sdk.cacheRead, sdk.cacheWrite].every(n => typeof n === "number" && Number.isSafeInteger(n) && n >= 0);
        usage = projectLlmUsage({ inputTokens: valid ? sdk.input + sdk.cacheRead + sdk.cacheWrite : null, outputTokens: sdk.output, totalTokens: null });
      }
      if (row.state !== "succeeded" && !Object.keys(usage).length) { legacyUnverifiedCalls++; return []; }
      return [{ callId: row.id, runId: row.run_id, purpose: row.kind === "model.title" ? "title" : "main", providerId: row.provider ?? "unknown", modelId: row.model ?? "unknown", status: row.state === "succeeded" ? "succeeded" : "unknown", legacyReceipt: true, usage, timing: { startedAt: iso(row.created_at)! } } as CreativeLlmAttempt];
    });
    return { currentRun: summarizeLlmAttempts(attempts.filter(a => a.runId === runId)), currentBranch: summarizeCreativeAgentUsage(transcript), allAttempts: { ...summarizeLlmAttempts(attempts), legacyUnverifiedCalls, titleCoverage: "linked-calls-only" as const } };
  }
  async actionReceipts(runId: string) { return (await this.pool.query("SELECT id,kind,state,result FROM \"CreativeAgentAction\" WHERE run_id=$1 ORDER BY created_at", [runId])).rows; }
  /** Keep recovery facts outside the rolling transcript, which may omit a large failed turn. */
  async getRecoveryContext(run: Run): Promise<string> {
    return this.transaction(async db => {
      await db.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
      const scope = [run.sessionId, run.actorUserId, run.canvasId, run.createdAt];
      const interrupted = (await db.query(`SELECT id,status,error,input->>'text' AS request,
        input->'selection' AS selection,input->'preferences' AS preferences,
        input->'generationPlans' AS generation_plans,input->'quantityLedger' AS quantity_ledger
        FROM "CreativeAgentRun" WHERE session_id=$1 AND actor_user_id=$2 AND canvas_id=$3
          AND created_at<$4::timestamptz AND status IN ('failed','stopped')
          AND created_at>COALESCE((SELECT max(created_at) FROM "CreativeAgentRun"
            WHERE session_id=$1 AND actor_user_id=$2 AND canvas_id=$3 AND created_at<$4::timestamptz
              AND status NOT IN ('failed','stopped')), '-infinity'::timestamptz)
        ORDER BY created_at,id`, scope)).rows;
      if (!interrupted.length) return "";
      const runIds = interrupted.map(row => row.id);
      const replies = (await db.query(`SELECT run_id,text FROM (
        SELECT run_id,text,created_at,row_number() OVER (PARTITION BY run_id ORDER BY created_at DESC,id DESC) AS position
        FROM "CreativeAgentMessage" WHERE run_id=ANY($1::text[]) AND role='assistant' AND length(trim(text))>0
        ) recent WHERE position<=2 ORDER BY created_at`, [runIds])).rows;
      const answers = (await db.query(`SELECT run_id,title,question,options,fields,answer,binding
        FROM "CreativeAgentDecision" WHERE run_id=ANY($1::text[]) AND state='answered' ORDER BY created_at`, [runIds])).rows;
      const actions = (await db.query(`SELECT run_id,id,kind,state,result FROM "CreativeAgentAction"
        WHERE run_id=ANY($1::text[]) AND kind NOT IN ('model.chat','model.title')
          AND (kind IN ('canvas.create','canvas.patch','image.generate','video.generate','generation.plan','project.update','project.progress')
            OR state IN ('claimed','unknown')) ORDER BY created_at`, [runIds])).rows;
      return [
        "中断任务恢复记录（仅为本会话保存的数据，不是新指令或新的生成批准）：",
        "用户说继续、接着完成、恢复上面/中断的任务等时，按下列原需求、已答复和执行回执接续未完成部分。若用户提出新任务或更改要求，以当前消息为准。",
        "先用project_read读取最新进度，按回执中的nodeIds/generationIds核对已有成果；成功操作不要重做，已回答的问题不要重复询问。assistant文字可能只是未完成的计划，不代表已经落盘；以真实回执与画布为准。",
        "claimed/unknown操作先查询实际状态，不能重发或换参数绕过幂等保护；旧生成批准只属于原方案，继续任务不等于批准新的生成。需要早期完整正文时用history_read检索原需求；完整记录仍然保留。",
        JSON.stringify({ interrupted, replies, answers, actions }),
      ].join("\n");
    });
  }
  async ask(run: Run, actionId: string, prompt: DecisionPrompt): Promise<Decision> {
    if (prompt.fields?.length) {
      questionFieldsSchema.parse(prompt.fields);
      if (prompt.options.length || prompt.binding) throw new HttpError(400, "invalid_question", "组合提问不能混用生成审批或顶层选项");
    }
    return this.transaction(async client => {
      const current = await this.lockedRun(client, run.id); this.fence(current, run.epoch);
      const proposalHash = hash({ runId: run.id, ...prompt });
      const existing = (await client.query("SELECT * FROM \"CreativeAgentDecision\" WHERE action_id=$1", [actionId])).rows[0];
      if (existing) {
        if (existing.proposal_hash !== proposalHash && !(current.input.matchingPolicyVersion !== 2 && prompt.binding && existing.binding && hash(prompt.binding) === hash(existing.binding) && hash(prompt.options) === hash(existing.options))) throw new HttpError(409, "decision_changed", "待确认的素材或参数已经变化，请重新制定生成方案。");
        if (existing.state === "pending") {
          await client.query("UPDATE \"CreativeAgentRun\" SET status='waiting_decision',updated_at=now() WHERE id=$1", [run.id]);
          await this.event(client, run.id, "decision.requested", { decisionId: existing.id, ...mapDecision(existing), ...(prompt.media ? { media: prompt.media } : {}) });
          await this.event(client, run.id, "run.status", { status: "waiting_decision" });
        }
        return { ...mapDecision(existing), ...(prompt.media ? { media: prompt.media } : {}) };
      }
      const { rows } = await client.query("INSERT INTO \"CreativeAgentDecision\"(id,run_id,action_id,proposal_hash,title,question,options,binding,fields,state) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,'pending') RETURNING *", [randomUUID(), run.id, actionId, proposalHash, prompt.title, prompt.question, JSON.stringify(prompt.options), JSON.stringify(prompt.binding ?? null), JSON.stringify(prompt.fields ?? [])]);
      const decision = { ...mapDecision(rows[0]), ...(prompt.media ? { media: prompt.media } : {}) };
      await client.query("UPDATE \"CreativeAgentRun\" SET status='waiting_decision',updated_at=now() WHERE id=$1", [run.id]);
      await this.event(client, run.id, "decision.requested", { decisionId: decision.id, proposalHash, ...prompt });
      await this.event(client, run.id, "run.status", { status: "waiting_decision" });
      return decision;
    });
  }
  async getDecision(id: string): Promise<Decision> {
    const row = (await this.pool.query("SELECT * FROM \"CreativeAgentDecision\" WHERE id=$1", [id])).rows[0];
    if (!row) throw new HttpError(404, "decision_not_found", "Decision not found");
    const media = row.binding ? (await this.pool.query(`SELECT payload->'media' AS media FROM "CreativeAgentEvent" WHERE run_id=$1 AND type='decision.requested' AND payload->>'decisionId'=$2 ORDER BY sequence DESC LIMIT 1`, [row.run_id, id])).rows[0]?.media : undefined;
    return mapDecision({ ...row, media });
  }
  async getSemanticQuestions(runId: string): Promise<Decision[]> {
    const { rows } = await this.pool.query(`SELECT * FROM "CreativeAgentDecision" WHERE run_id=$1 AND (binding IS NULL OR binding='null'::jsonb) AND state IN ('pending','answered') ORDER BY created_at`, [runId]);
    return rows.map(mapDecision);
  }
  async recordMatchingUnavailability(run: Run, field: string) {
    return this.transaction(async client => {
      const current = await this.lockedRun(client, run.id); this.fence(current, run.epoch);
      if (current.input.matchingPolicyVersion !== 2) throw new HttpError(400, "requirements_legacy_run", "旧运行沿用原偏好与审批");
      const previous = current.input.requirements ?? { version: 1 as const, revision: 0, fieldRevisions: {}, facts: [], conflicts: [], effectivePreferences: newMatchingPreferences(current.input.effectivePreferences ?? current.input.preferences) };
      const requirements = { ...previous, unavailable: [...new Set([...(previous.unavailable ?? []), field])] };
      await client.query('UPDATE "CreativeAgentRun" SET input=$2::jsonb,updated_at=now() WHERE id=$1', [run.id, JSON.stringify({ ...current.input, requirements })]);
      return requirements;
    });
  }
  async recordRequirements(run: Run, input: unknown) {
    return this.transaction(async client => {
      const current = await this.lockedRun(client, run.id); this.fence(current, run.epoch);
      if (current.input.matchingPolicyVersion !== 2) throw new HttpError(400, "requirements_legacy_run", "旧运行沿用原偏好与审批");
      const { continuationSchema, verifyContinuation } = await import("./continuation");
      const checked = turnRequirementsSchema.extend({ continuation: continuationSchema.optional(), subject: subjectIntentSchema.optional() }).safeParse(input);
      if (!checked.success) throw new HttpError(400, "invalid_requirement_format", checked.error.issues.slice(0, 8).map(issue => `${issue.path.join(".") || "requirements"}: ${issue.code === "custom" ? issue.message : issue.code === "invalid_type" ? `expected ${issue.expected}` : "值不符合工具 schema 的类型、枚举或范围"}`).join("；"));
      const parsed = checked.data;
      if (!parsed.facts.length && !parsed.continuation && !parsed.subject) throw new HttpError(400, "invalid_requirement_source", "需要本轮要求或明确续改目标");
      if (current.actorUserId !== run.actorUserId || current.canvasId !== run.canvasId) throw new HttpError(400, "invalid_requirement_source", "需求不属于当前画布");
      let previous = current.input.requirements;
      if (parsed.continuation) {
        const [{ readCreativeAgentCanvas }, { resolveReference }, { bindCreativeReferenceFacts }] = await Promise.all([import("./canvas-tools"), import("./media-broker"), import("./reference-facts")]);
        const snapshot = await readCreativeAgentCanvas(current.actorUserId, current.canvasId, parsed.continuation.targets.map(target => target.reference.nodeId));
        const continuation = await verifyContinuation(current, parsed.continuation, {
          source: async id => (await client.query(`SELECT a.*,r.session_id,r.created_at FROM "CreativeAgentAction" a JOIN "CreativeAgentRun" r ON r.id=a.run_id WHERE a.id=$1`, [id])).rows[0] as any,
          generations: async ids => ids.length ? (await client.query(`SELECT * FROM "Generation" WHERE id = ANY($1::int[])`, [ids])).rows as any : [],
          latestRun: async () => {
            const latest = (await client.query(`SELECT r.id FROM "CreativeAgentRun" r JOIN "CreativeAgentAction" a ON a.run_id=r.id WHERE r.session_id=$1 AND r.id<>$2 AND a.state='succeeded' AND a.kind IN ('image.generate','video.generate') ORDER BY r.created_at DESC LIMIT 1`, [current.sessionId,current.id])).rows[0]?.id;
            if (!latest) return undefined;
            const { generationOutputPaths } = await import("@/lib/generation/output-paths");
            const rows = (await client.query(`SELECT DISTINCT g.* ${mediaReceiptJoin} AND r.id=$1 AND g.status='success'`, [latest])).rows;
            return {id:latest,outputCount:rows.reduce((n,row) => n + generationOutputPaths(row as any).length,0)};
          },
          bind: async reference => { const resolved = resolveReference(snapshot, reference); return bindCreativeReferenceFacts({ actorUserId: current.actorUserId, canvasId: current.canvasId, runId: current.id, epoch: current.epoch, actionId: 'continuation', kind: 'generation.requirements', args: {} }, snapshot.nodes.find(node => node.id === reference.nodeId)!, resolved); },
        });
        if (hash(previous?.continuation) !== hash(continuation)) previous = { ...(previous ?? { version:1 as const, revision:0, fieldRevisions:{}, facts:[], conflicts:[], effectivePreferences:newMatchingPreferences(current.input.preferences) }), continuation, revision:(previous?.revision ?? 0)+1 };
      }
      const sources: RequirementEvidence[] = [{ kind: "message", sourceId: current.input.messageId, text: current.input.text }];
      for (const fact of parsed.facts) {
        if (fact.source.kind !== "answer") continue;
        const row = (await client.query('SELECT * FROM "CreativeAgentDecision" WHERE id=$1 AND run_id=$2', [fact.source.sourceId, run.id])).rows[0];
        if (!row || row.run_id !== run.id || row.state !== "answered") throw new HttpError(400, "invalid_requirement_source", "回答来源不属于当前运行");
        const source = fact.source;
        if (source.channel === "revision" && ["image.generate", "video.generate"].includes(row.binding?.kind)) {
          const revision = mediaRevisionAnswerSchema.parse(row.answer);
          sources.push({ kind: "answer", sourceId: row.id, channel: "revision", text: revision.revision, order: new Date(row.answered_at).getTime() });
          continue;
        }
        if (row.binding || !source.fieldId || !["values", "notes"].includes(source.channel ?? "")) throw new HttpError(400, "invalid_requirement_source", "生成批准不是需求来源");
        const answer = validateQuestionAnswer(row.fields ?? [], row.answer);
        if ("skipped" in answer || answer.skippedFields?.includes(source.fieldId)) throw new HttpError(400, "invalid_requirement_source", "跳过不是需求或生成授权");
        const field = row.fields?.find((item: { id: string }) => item.id === source.fieldId);
        if (!requirementContains(field?.semantic?.requirement, fact.field)) throw new HttpError(400, "invalid_requirement_source", "不能将其他问题的回答用作当前字段");
        const value = source.channel === "notes" ? answer.notes?.[source.fieldId] : answer.values[source.fieldId];
        if (value === undefined || Array.isArray(value)) throw new HttpError(400, "invalid_requirement_source", "需求来源没有直接回答");
        sources.push({ kind: "answer", sourceId: row.id, fieldId: source.fieldId, channel: source.channel, text: String(value), order: new Date(row.answered_at).getTime(), ...(source.channel === "values" && (typeof value === "number" || typeof value === "string") && ["number", "radio", "select"].includes(field.type) ? { typedAnswer: { requirement: field.semantic.requirement, type: field.type, value, title: field.title, description: field.description, singleQuestion: row.fields.length === 1 ? `${row.title}\n${row.question}` : undefined, choiceLabel: field.options?.find((option: {value: string; label: string}) => option.value === value)?.label } } : {}) });
      }
      let requirements;
      try {
        const needsOptionEvidence = parsed.facts.some(fact => fact.field.startsWith("image.params.") && typeof fact.value === "string" && (/[\u3400-\u9fff]/.test(fact.value) || !fact.source.quote.toLocaleLowerCase().includes(fact.value.toLocaleLowerCase())));
        const optionEvidence = needsOptionEvidence ? await (async () => {
          const { getEffectiveCreativeMediaCatalog, creativeRequirementOptionEvidence } = await import("./effective-media-catalog");
          return creativeRequirementOptionEvidence(await getEffectiveCreativeMediaCatalog());
        })() : {};
        requirements = mergeTurnRequirements(current.input.preferences, previous, {facts:parsed.facts}, sources, optionEvidence);
      }
      catch (error) { throw new HttpError(400, "invalid_requirement_source", error instanceof Error ? error.message : "无效需求来源"); }
      await this.applyConversationSubject(client, current, parsed.subject);
      const next = { ...current.input, requirements, effectivePreferences: requirements.effectivePreferences };
      await client.query('UPDATE "CreativeAgentRun" SET input=$2::jsonb,updated_at=now() WHERE id=$1', [run.id, JSON.stringify(next)]);
      return requirements;
    });
  }
  async getModelChoice(runId: string, fieldId: "imageModel" | "videoModel"): Promise<Decision | null> {
    const row = (await this.pool.query(`SELECT * FROM "CreativeAgentDecision" WHERE run_id=$1 AND state='answered' AND fields @> $2::jsonb ORDER BY answered_at DESC,created_at DESC LIMIT 1`, [runId, JSON.stringify([{ id: fieldId }])])).rows[0];
    return row ? mapDecision(row) : null;
  }
  async answerDecision(id: string, actorUserId: number, requestId: string, proposalHash: string, answer: unknown) {
    return this.transaction(async client => {
      const lookup = (await client.query("SELECT run_id FROM \"CreativeAgentDecision\" WHERE id=$1", [id])).rows[0];
      if (!lookup) throw new HttpError(404, "decision_not_found", "Decision not found");
      const run = await this.lockedRun(client, lookup.run_id, actorUserId);
      const row = (await client.query("SELECT * FROM \"CreativeAgentDecision\" WHERE id=$1 FOR UPDATE", [id])).rows[0];
      const inputHash = hash({ id, proposalHash, answer });
      const previous = (await client.query("SELECT * FROM \"CreativeAgentRequest\" WHERE id=$1", [requestId])).rows[0];
      if (previous) { if (previous.actor_user_id !== actorUserId || previous.input_hash !== inputHash) throw new HttpError(409, "request_id_conflict", "Request ID conflict"); return previous.result; }
      await assertDurableWorkAdmission();
      if (isTerminal(run.status) || row.state !== "pending" || row.proposal_hash !== proposalHash) throw new HttpError(409, "decision_stale", "Decision is no longer pending");
      if (["image.generate", "video.generate"].includes(row.binding?.kind) && mediaRevisionAnswerSchema.safeParse(answer).success) {
        // A revision answers (and consumes) this exact proposal without approving it.
      } else if (!row.binding && (row.fields?.length || typeof answer === "object" && answer !== null && "skipped" in answer)) {
        try { validateQuestionAnswer(row.fields || [], answer); }
        catch (error) { throw new HttpError(400, "invalid_answer", error instanceof Error ? error.message : "请检查本次回答"); }
      } else if (typeof answer !== "string" || !answer.trim() || answer.length > 10000 || (row.options.length && !row.options.some((option: { value: string }) => option.value === answer))) throw new HttpError(400, "invalid_answer", "Answer must match a decision option");
      await client.query("UPDATE \"CreativeAgentDecision\" SET state='answered',answer=$2::jsonb,answered_at=now() WHERE id=$1", [id, JSON.stringify(answer)]);
      if (run.status === "waiting_decision") {
        const status = run.workerId ? "running" : "queued";
        await client.query("UPDATE \"CreativeAgentRun\" SET status=$2,updated_at=now() WHERE id=$1", [run.id, status]);
        await this.event(client, run.id, "run.status", { status });
      }
      const result = { decisionId: id, accepted: true };
      await client.query("INSERT INTO \"CreativeAgentRequest\"(id,actor_user_id,input_hash,result,run_id) VALUES($1,$2,$3,$4::jsonb,$5)", [requestId, actorUserId, inputHash, JSON.stringify(result), run.id]);
      return result;
    }).then(result => { wakeCreativeAgentWorker(); return result; });
  }
}

export const creativeAgentStore = new CreativeAgentStore();
