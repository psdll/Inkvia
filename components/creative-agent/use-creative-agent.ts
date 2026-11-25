"use client";

import * as React from "react";
import type { DecisionAnswer } from "@/lib/creative-agent/questions";
import { streamCreativeEvents } from "@/lib/creative-agent/event-stream-client";
import {
  creativeAgentClient,
  CreativeAgentClientError,
} from "@/lib/creative-agent/client";
import {
  isCreativeAgentRunActive,
  type CreativeAgentCanvasContext,
  type CreativeAgentCapabilities,
  type CreativeAgentMessageInput,
  type CreativeAgentRun,
  type CreativeAgentSessionSnapshot,
} from "@/lib/creative-agent/contracts";
import {
  applyAgentEvents,
  finishAgentEventDrain,
  emptyAgentState,
  restoreAgentSnapshot,
  type AgentViewState,
} from "./state";

const volatilePending = new Map<string, CreativeAgentMessageInput>();
const pendingKey = (canvasId: number, sessionId: string) =>
  `creative-agent:pending:v2:${canvasId}:${sessionId}`;
function readPending(canvasId: number, sessionId: string): CreativeAgentMessageInput | null {
  const key = pendingKey(canvasId, sessionId);
  if (volatilePending.has(key)) return volatilePending.get(key)!;
  try {
    const value = JSON.parse(
      sessionStorage.getItem(key) || sessionStorage.getItem(`creative-agent:pending:v1:${canvasId}`) || "null",
    );
    return value &&
      value.sessionId === sessionId &&
      typeof value.messageId === "string" &&
      typeof value.text === "string" &&
      typeof value.baseRevision === "string" &&
      Array.isArray(value.selection?.nodeIds) &&
      Array.isArray(value.selection?.references)
      ? value
      : null;
  } catch {
    return null;
  }
}
function savePending(
  canvasId: number,
  sessionId: string,
  input: CreativeAgentMessageInput | null,
) {
  const key = pendingKey(canvasId, sessionId);
  if (input) volatilePending.set(key, input);
  else volatilePending.delete(key);
  try {
    if (input)
      sessionStorage.setItem(key, JSON.stringify(input));
    else sessionStorage.removeItem(key);
    const legacyKey = `creative-agent:pending:v1:${canvasId}`;
    const legacy = JSON.parse(sessionStorage.getItem(legacyKey) || "null");
    if (legacy?.sessionId === sessionId) sessionStorage.removeItem(legacyKey);
  } catch {
    /* Memory retains the request across dock unmounts if storage is unavailable. */
  }
}
const uncertainMessage = "上次消息的接收结果尚未确认，请核对并重试。";

const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : "请求失败，请重试。";
export function useCreativeAgent({
  canvasId,
  sessionId,
  onPrepareMessage,
  onCanvasCommitted,
}: {
  canvasId: number;
  sessionId: string;
  onPrepareMessage: () => Promise<CreativeAgentCanvasContext>;
  onCanvasCommitted: () => Promise<void>;
}) {
  const [view, setView] = React.useState(emptyAgentState);
  const viewRef = React.useRef(view);
  const selectedModelRef = React.useRef<{ providerId: string; modelId: string }>();
  const capabilityRequest = React.useRef(0);
  const usageRequest = React.useRef(0);
  const [capabilities, setCapabilities] =
    React.useState<CreativeAgentCapabilities | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [draft, setDraftState] = React.useState("");
  const draftKey = `creative-agent:draft:v1:${canvasId}:${sessionId}`;
  const setDraft = React.useCallback((value: string) => {
    setDraftState(value);
    try { sessionStorage.setItem(draftKey, value); } catch { /* Keep the mounted draft. */ }
  }, [draftKey]);
  const skillKey = `creative-agent:skill-intent:v1:${canvasId}:${sessionId}`;
  const [committedSkillId, setCommittedSkillId] = React.useState<string | null>(null);
  const [skillIntent, setSkillIntent] = React.useState<string | null | undefined>();
  const setSelectedSkillId = React.useCallback((value: string | null) => {
    setSkillIntent(value);
    try { sessionStorage.setItem(skillKey, JSON.stringify(value)); } catch { /* Keep mounted selection. */ }
  }, [skillKey]);
  const acceptSkill = (value: string | null) => {
    setCommittedSkillId(value); setSkillIntent(undefined);
    try { sessionStorage.removeItem(skillKey); } catch { /* Server remains authoritative. */ }
  };
  const [sending, setSending] = React.useState(false);
  const [revising, setRevising] = React.useState(false);
  const streamEpoch = React.useRef(0);
  const [syncing, setSyncing] = React.useState(false);
  const syncingRef = React.useRef(false);
  const [uncertain, setUncertain] = React.useState(false);
  const [controlBusy, setControlBusy] = React.useState(false);
  const [decisionBusy, setDecisionBusy] = React.useState(false);
  const [online, setOnline] = React.useState(
    () => typeof navigator === "undefined" || navigator.onLine,
  );
  const [retry, setRetry] = React.useState(0);
  const pending = React.useRef<CreativeAgentMessageInput | null>(null);
  const busy = React.useRef(false);
  const controlling = React.useRef(false);
  const answering = React.useRef(false);
  const controlRequest = React.useRef<{
    key: string;
    requestId: string;
  } | null>(null);
  const answerRequest = React.useRef<{ key: string; requestId: string } | null>(
    null,
  );
  const callbacks = React.useRef({ onPrepareMessage, onCanvasCommitted });
  callbacks.current = { onPrepareMessage, onCanvasCommitted };
  const epoch = React.useRef(0);
  const update = React.useCallback(
    (value: AgentViewState | ((current: AgentViewState) => AgentViewState)) => {
      const next = typeof value === "function" ? value(viewRef.current) : value;
      viewRef.current = next;
      setView(next);
    },
    [],
  );

  // 上次看到的对话先显示出来，服务器的最新数据回来后再替换（刷新页面不用干等）；每次拿到服务器快照都更新缓存
  const snapshotKey = `creative-agent:snapshot:v1:${canvasId}:${sessionId ?? "latest"}`;
  /** False while the view shows only the browser's cached copy of this conversation. */
  const serverLoaded = React.useRef(false);
  /** The opening fetch of this conversation, shared so a superseding check doesn't repeat it. */
  const openingFetch = React.useRef<Promise<CreativeAgentSessionSnapshot> | undefined>(undefined);
  const restoreSnapshot = React.useCallback((snapshot: CreativeAgentSessionSnapshot, fromCache = false) => {
    if (!fromCache) serverLoaded.current = true;
    update(restoreAgentSnapshot(snapshot));
    setCommittedSkillId(snapshot.session?.activeSkillId ?? null);
    if (!fromCache) try { localStorage.setItem(snapshotKey, JSON.stringify(snapshot)); } catch { /* 存不下就不缓存 */ }
  }, [update, snapshotKey]);

  React.useEffect(() => {
    const id = ++epoch.current;
    const abort = new AbortController();
    pending.current = readPending(canvasId, sessionId);
    busy.current = false;
    controlling.current = false;
    answering.current = false;
    controlRequest.current = null;
    answerRequest.current = null;
    setControlBusy(false);
    setDecisionBusy(false);
    update(emptyAgentState());
    serverLoaded.current = false;
    openingFetch.current = undefined;
    let savedDraft = "";
    try { savedDraft = sessionStorage.getItem(draftKey) || ""; } catch { /* Storage is optional. */ }
    setDraftState(pending.current?.text ?? savedDraft);
    setCommittedSkillId(null);
    let savedSkill: string | null | undefined;
    try { const saved = sessionStorage.getItem(skillKey); savedSkill = saved === null ? undefined : JSON.parse(saved); } catch { /* Storage is optional. */ }
    setSkillIntent(pending.current && "selectedSkillId" in pending.current ? pending.current.selectedSkillId : savedSkill);
    setUncertain(Boolean(pending.current));
    setSending(false);
    setSyncing(false);
    syncingRef.current = false;
    setLoading(true);
    setError(pending.current ? uncertainMessage : null);
    setCapabilities(null);
    let hasCache = false;
    try {
      const cached = JSON.parse(localStorage.getItem(snapshotKey) || "null") as CreativeAgentSessionSnapshot | null;
      if (cached?.messages) { restoreSnapshot(cached, true); setLoading(false); hasCache = true; }
    } catch { /* 缓存只是加速，读不到就等服务器 */ }
    async function load() {
      try {
        const capabilityId = ++capabilityRequest.current;
        // 上次用过（有缓存）时能力检查和读取对话同时发出；第一次仍先确认功能已开启再读对话
        const early = hasCache ? creativeAgentClient.session(canvasId, abort.signal, sessionId) : undefined;
        early?.catch(() => undefined);
        openingFetch.current = early;
        const caps = await creativeAgentClient.capabilities(abort.signal, selectedModelRef.current);
        if (epoch.current !== id || capabilityId !== capabilityRequest.current) return;
        setCapabilities(caps);
        if (caps.enabled) {
          const snapshot = await (early ?? creativeAgentClient.session(canvasId, abort.signal, sessionId));
          if (epoch.current === id) {
            restoreSnapshot(snapshot);
            if (
              pending.current &&
              snapshot.messages.some(
                (message) => message.id === pending.current!.messageId,
              )
            ) {
              acceptSkill(snapshot.session?.activeSkillId ?? null);
              pending.current = null;
              savePending(canvasId, sessionId, null);
              setDraft("");
              setUncertain(false);
              setError(null);
            }
          }
        }
      } catch (reason) {
        if (!abort.signal.aborted && epoch.current === id)
          setError(messageOf(reason));
      } finally {
        if (epoch.current === id) setLoading(false);
      }
    }
    void load();
    return () => {
      abort.abort();
      epoch.current++;
    };
  }, [canvasId, sessionId, draftKey, setDraft, update, restoreSnapshot]);

  React.useEffect(() => {
    const goOnline = () => {
      setOnline(true);
      setRetry((value) => value + 1);
    };
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  React.useEffect(() => {
    const runId = view.run?.id;
    if (!runId) {
      syncingRef.current = false;
      setSyncing(false);
      return;
    }
    if (!online) return;
    syncingRef.current = true;
    setSyncing(true);
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const streamId = ++streamEpoch.current;
    const receive = async (batch: import("@/lib/creative-agent/contracts").CreativeAgentEventsResponse) => {
      if (abort.signal.aborted || streamId !== streamEpoch.current) return;
      const after = viewRef.current.sequence;
      if (batch.events.some(event => event.runId === runId && event.sequence > after && event.type === "canvas.committed") ||
        batch.media?.some(media => media.nodeIds.length && !viewRef.current.media.some(old => old.generationId === media.generationId && old.nodeIds.length && old.status === media.status))) {
        await callbacks.current.onCanvasCommitted();
      }
      if (abort.signal.aborted || streamId !== streamEpoch.current) return;
      update(current => current.run?.id === runId ? {
        ...applyAgentEvents(current, batch.events, batch.run),
        sequence: Math.max(current.sequence, batch.nextSequence),
        ...(batch.media ? { media: batch.media } : {}),
        mediaPending: batch.mediaPending,
        ...(batch.editableMessageId !== undefined ? { editableMessageId: batch.editableMessageId } : {}),
      } : current);
      setError(pending.current ? uncertainMessage : null);
      // Media delivery can continue after a failed chat without locking the composer.
      if (!isCreativeAgentRunActive(batch.run.status) && batch.nextSequence <= after) { syncingRef.current = false; setSyncing(false); }
    };
    const finish = () => {
      if (abort.signal.aborted || streamId !== streamEpoch.current) return;
      update(current => current.run?.id === runId ? finishAgentEventDrain(current) : current);
      syncingRef.current = false;
      setSyncing(false);
    };
    async function poll() {
      try {
        const after = viewRef.current.sequence;
        const batch = await creativeAgentClient.events(runId!, after, abort.signal);
        await receive(batch);
        if (abort.signal.aborted || streamId !== streamEpoch.current) return;
        if (!isCreativeAgentRunActive(batch.run.status) && !batch.mediaPending && batch.nextSequence <= after) finish();
        else timer = setTimeout(poll, batch.nextSequence > after ? 100 : 1200);
      } catch (reason) {
        if (!abort.signal.aborted && streamId === streamEpoch.current) { setError(messageOf(reason)); timer = setTimeout(poll, 3500); }
      }
    }
    async function stream() {
      try {
        const drained = await streamCreativeEvents(runId!, viewRef.current.sequence, abort.signal, receive);
        if (abort.signal.aborted || streamId !== streamEpoch.current) return;
        if (drained) finish();
        else timer = setTimeout(stream, 250);
      } catch {
        if (!abort.signal.aborted && streamId === streamEpoch.current) void poll();
      }
    }
    void stream();
    return () => {
      abort.abort();
      if (timer) clearTimeout(timer);
    };
  }, [view.run?.id, online, retry, update]);

  const refreshCapabilities = React.useCallback(async (model: { providerId: string; modelId: string } | undefined, signal: AbortSignal) => {
    selectedModelRef.current = model;
    const capabilityId = ++capabilityRequest.current;
    const caps = await creativeAgentClient.capabilities(signal, model);
    if (signal.aborted || capabilityId !== capabilityRequest.current) return;
    setCapabilities(caps);
    // A newer check supersedes the initial load, which then stops; if the view still holds
    // only the cached copy (often empty), this check must fetch the conversation itself.
    if (caps.enabled && (!viewRef.current.sessionId || !serverLoaded.current)) {
      const snapshot = await (openingFetch.current ?? creativeAgentClient.session(canvasId, signal, sessionId));
      if (!signal.aborted && !serverLoaded.current) restoreSnapshot(snapshot);
    }
  }, [canvasId, sessionId, restoreSnapshot]);
  const refreshUsage = React.useCallback(async () => {
    const id = epoch.current, requestId = ++usageRequest.current;
    const snapshot = await creativeAgentClient.session(canvasId, undefined, sessionId);
    if (requestId === usageRequest.current && id === epoch.current && snapshot.sessionId === viewRef.current.sessionId && snapshot.latestSequence >= (viewRef.current.usageSequence ?? 0)) update(current => ({...current,usage:snapshot.usage,usageScopes:snapshot.usageScopes,usageSequence:snapshot.latestSequence}));
  }, [canvasId,sessionId,update]);
  const reconnect = async () => {
    if (loading) return;
    const id = epoch.current;
    setLoading(true);
    setError(null);
    try {
      const capabilityId = ++capabilityRequest.current;
      const caps = await creativeAgentClient.capabilities(undefined, selectedModelRef.current);
      if (epoch.current !== id || capabilityId !== capabilityRequest.current) return;
      setCapabilities(caps);
      if (caps.enabled) {
        const snapshot = await creativeAgentClient.session(canvasId, undefined, sessionId);
        if (epoch.current !== id) return;
        restoreSnapshot(snapshot);
        setRetry((value) => value + 1);
      }
    } catch (reason) {
      if (epoch.current === id) setError(messageOf(reason));
    } finally {
      if (epoch.current === id) setLoading(false);
    }
  };

  const send = async (options: import("@/lib/creative-agent/contracts").CreativeAgentInputOptions = {}) => {
    if (
      busy.current ||
      !online ||
      !capabilities?.enabled ||
      !capabilities.ready ||
      (!pending.current &&
        (syncingRef.current ||
          !draft.trim() ||
          (viewRef.current.run &&
            isCreativeAgentRunActive(viewRef.current.run.status))))
    )
      return;
    busy.current = true;
    setSending(true);
    setError(null);
    const id = epoch.current;
    let posted = false;
    try {
      if (!pending.current) {
        const context = await callbacks.current.onPrepareMessage();
        if (epoch.current !== id) return;
        if (context.canvasId !== canvasId)
          throw new Error("画布已切换，请在当前画布重新发送。");
        pending.current = {
          messageId: crypto.randomUUID(),
          sessionId,
          text: draft.trim(),
          baseRevision: context.revision,
          selection: JSON.parse(JSON.stringify(context.selection)),
          ...JSON.parse(JSON.stringify(options)),
          ...(skillIntent !== undefined ? { selectedSkillId: skillIntent } : {}),
        };
      } else {
        const snapshot = await creativeAgentClient.session(canvasId, undefined, sessionId);
        if (epoch.current !== id) return;
        if (
          snapshot.messages.some(
            (message) => message.id === pending.current!.messageId,
          )
        ) {
          restoreSnapshot(snapshot);
          acceptSkill(snapshot.session?.activeSkillId ?? null);
          pending.current = null;
          savePending(canvasId, sessionId, null);
          setDraft("");
          setUncertain(false);
          setRetry((value) => value + 1);
          return true;
        }
      }
      const input = pending.current;
      if (!input) return;
      savePending(canvasId, sessionId, input);
      posted = true;
      // 以点击发送的时刻作为本轮起点（接口偶尔较慢，不能用返回后的时间）
      const now = new Date().toISOString();
      const accepted = await creativeAgentClient.send(canvasId, input);
      if (epoch.current !== id) return;
      const run: CreativeAgentRun = {
        id: accepted.runId,
        sessionId: accepted.sessionId,
        canvasId,
        status: "queued",
        createdAt: now,
        updatedAt: now,
      };
      update((current) => ({
        ...current,
        sessionId: accepted.sessionId,
        run,
        sequence: 0,
        actualModel: undefined,
        thinkingLabel: undefined,
        tools: current.tools,
        decision: null,
        error: null,
        messages: current.messages.some(
          (message) => message.id === input.messageId,
        )
          ? current.messages
          : [
              ...current.messages,
              {
                id: input.messageId,
                role: "user",
                text: input.text,
                selectedSkillId: input.selectedSkillId !== undefined ? input.selectedSkillId : committedSkillId,
                createdAt: now,
                runId: run.id,
                references: input.selection.references,
              },
            ],
      }));
      const commandSkill = input.text.match(/^\s*\/skill:((?:system|personal):[1-9]\d*)/);
      acceptSkill(input.selectedSkillId !== undefined ? input.selectedSkillId : commandSkill?.[1] ?? committedSkillId);
      pending.current = null;
      savePending(canvasId, sessionId, null);
      setDraft("");
      setUncertain(false);
      return true;
    } catch (reason) {
      if (epoch.current !== id) return;
      setError(messageOf(reason));
      const definiteRejection =
        posted &&
        reason instanceof CreativeAgentClientError &&
        reason.status !== null &&
        reason.status < 500;
      if (definiteRejection) {
        pending.current = null;
        savePending(canvasId, sessionId, null);
      }
      setUncertain(Boolean(pending.current));
    } finally {
      if (epoch.current === id) {
        busy.current = false;
        setSending(false);
      }
    }
  };

  const revise = async (input: import("@/lib/creative-agent/contracts").CreativeAgentMessageRevision) => {
    if (busy.current || !online) return false;
    busy.current = true;
    setRevising(true);
    ++streamEpoch.current;
    const id = epoch.current;
    try {
      const snapshot = await creativeAgentClient.revise(canvasId, input);
      if (epoch.current !== id) return false;
      restoreSnapshot(snapshot);
      setError(null);
      return true;
    } catch (reason) {
      if (epoch.current === id) {
        setError(messageOf(reason));
        if (reason instanceof CreativeAgentClientError && reason.status === 409) {
          const snapshot = await creativeAgentClient.session(canvasId, undefined, sessionId).catch(() => null);
          if (snapshot && epoch.current === id) restoreSnapshot(snapshot);
        }
      }
      return false;
    } finally {
      if (epoch.current === id) { busy.current = false; setRevising(false); setRetry(value => value + 1); }
    }
  };

  const control = async (action: "pause" | "stop" | "resume" | "continue") => {
    const run = viewRef.current.run;
    if (!run || controlling.current || !online) return;
    controlling.current = true;
    const id = epoch.current;
    const key = `${run.id}:${action}`;
    if (controlRequest.current?.key !== key)
      controlRequest.current = { key, requestId: crypto.randomUUID() };
    setControlBusy(true);
    setError(null);
    try {
      const result = await creativeAgentClient.control(run.id, {
        requestId: controlRequest.current.requestId,
        action,
      });
      if (epoch.current !== id) return;
      if (result.run) update((current) => ({ ...current, run: result.run }));
      controlRequest.current = null;
      setRetry((value) => value + 1);
    } catch (reason) {
      if (epoch.current === id) setError(messageOf(reason));
    } finally {
      if (epoch.current === id) {
        controlling.current = false;
        setControlBusy(false);
      }
    }
  };

  const answer = async (value: DecisionAnswer) => {
    const decision = viewRef.current.decision;
    if (
      !decision ||
      answering.current ||
      !online ||
      (typeof value === "string" && !value.trim()) ||
      (decision.expiresAt && Date.parse(decision.expiresAt) <= Date.now())
    )
      return false;
    const id = epoch.current;
    answering.current = true;
    const key = `${decision.id}:${decision.proposalHash}:${JSON.stringify(value)}`;
    if (answerRequest.current?.key !== key)
      answerRequest.current = { key, requestId: crypto.randomUUID() };
    setDecisionBusy(true);
    setError(null);
    try {
      await creativeAgentClient.answer(decision.id, {
        requestId: answerRequest.current.requestId,
        proposalHash: decision.proposalHash,
        answer: value,
      });
      if (epoch.current !== id) return true;
      update((current) => ({ ...current, decision: null }));
      answerRequest.current = null;
      setRetry((count) => count + 1);
      return true;
    } catch (reason) {
      if (epoch.current !== id) return false;
      setError(messageOf(reason));
      if (reason instanceof CreativeAgentClientError && reason.status === 409) {
        update((current) => ({ ...current, decision: null }));
        setRetry((count) => count + 1);
      }
      return false;
    } finally {
      if (epoch.current === id) {
        answering.current = false;
        setDecisionBusy(false);
      }
    }
  };
  return {
    // 输入框只显示为下一条消息明确选择的技能；发出后清空。对话沿用的技能由服务端记住，Agent 需要时自行读取
    selectedSkillId: skillIntent !== undefined ? skillIntent : null,
    setSelectedSkillId,
    view,
    capabilities,
    refreshCapabilities,
    refreshUsage,
    loading,
    error: error || view.error || view.run?.error,
    draft,
    setDraft,
    sending,
    revising,
    syncing,
    uncertain,
    online,
    controlBusy,
    decisionBusy,
    send,
    revise,
    control,
    answer,
    reconnect,
  };
}
