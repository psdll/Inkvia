"use client";
import { UiProps, UiText, useUiLocale } from "@/i18n/ui";

import * as React from "react";
import { Check, ChevronRight, LocateFixed, RefreshCw } from "lucide-react";
import {
  creativeStageLabels,
  type CreativeProjectSnapshot,
} from "@/lib/creative-agent/project-contracts";
import type { CreativeAgentReference } from "@/lib/creative-agent/contracts";
import styles from "./canvas-agent.module.css";

export function AgentProject({
  canvasId,
  sessionId,
  refreshKey,
  selected,
  onLocate,
  prepare,
}: {
  canvasId: number;
  sessionId: string;
  refreshKey: string;
  selected: CreativeAgentReference[];
  onLocate?: (nodeId: string) => void;
  prepare: () => Promise<unknown>;
}) {
  const { label: uiLabel, error: uiError } = useUiLocale();
  const [snapshot, setSnapshot] =
    React.useState<CreativeProjectSnapshot | null>(null);
  const [open, setOpen] = React.useState(false);
  const [error, setError] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [constraints, setConstraints] = React.useState("");
  const [constraintsRevision, setConstraintsRevision] = React.useState<
    number | null
  >(null);
  const [hasPending, setHasPending] = React.useState(false);
  const [editing, setEditing] = React.useState(false);
  const pending = React.useRef<{ requestId: string; update: unknown } | null>(
    null,
  );
  const pendingKey = `creative-agent:project-pending:${canvasId}:${sessionId}`;
  React.useEffect(() => {
    pending.current = null;
    try {
      const saved = sessionStorage.getItem(pendingKey);
      if (saved) {
        const value = JSON.parse(saved);
        if (
          typeof value.requestId === "string" &&
          value.update &&
          typeof value.update === "object"
        )
          pending.current = value;
      }
    } catch {
      /* Keep the server as authority. */
    }
    setHasPending(!!pending.current);
    setEditing(false);
    setConstraintsRevision(null);
  }, [pendingKey]);
  const clearPending = () => {
    pending.current = null;
    setHasPending(false);
    try {
      sessionStorage.removeItem(pendingKey);
    } catch {
      /* Server receipt still protects completed requests. */
    }
  };
  const selectionKey = JSON.stringify(selected.map((item) => item.nodeId));
  const load = React.useCallback(
    async (signal?: AbortSignal) => {
      const response = await fetch(
        `/api/creative-agent/canvases/${canvasId}/project?sessionId=${encodeURIComponent(sessionId)}&nodeIds=${encodeURIComponent(selectionKey)}`,
        { signal, cache: "no-store" },
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "项目记录读取失败");
      if (!signal?.aborted) setSnapshot(data);
      return data as CreativeProjectSnapshot;
    },
    [canvasId, sessionId, selectionKey],
  );
  React.useEffect(() => {
    const abort = new AbortController();
    void load(abort.signal).catch((reason) => {
      if (!abort.signal.aborted) setError(reason.message);
    });
    return () => abort.abort();
  }, [load, refreshKey]);
  const save = async (update: unknown) => {
    if (busy) return;
    if (
      pending.current &&
      JSON.stringify(update) !== JSON.stringify(pending.current.update)
    ) {
      setError("上次确认结果尚未核实，请先点击重试上次确认请求。");
      return;
    }
    setBusy(true);
    setError("");
    try {
      // Reuse exactly the same request if the response was lost.
      if (!pending.current)
        pending.current = { requestId: crypto.randomUUID(), update };
      try {
        sessionStorage.setItem(pendingKey, JSON.stringify(pending.current));
      } catch {
        /* Keep the exact request in memory if storage is unavailable. */
      }
      setHasPending(true);
      const response = await fetch(
        `/api/creative-agent/canvases/${canvasId}/project`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(pending.current),
        },
      );
      const data = await response.json();
      if (!response.ok) {
        if (response.status < 500) clearPending();
        throw new Error(data.error || "保存未完成");
      }
      clearPending();
      setEditing(false);
      await load();
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "保存未完成，请核对后重试",
      );
    } finally {
      setBusy(false);
    }
  };
  const adopt = async (selectedRef: CreativeAgentReference) => {
    try {
      if (pending.current) {
        setError("上次确认结果尚未核实，请先点击重试上次确认请求。");
        return;
      }
      await prepare();
      const fresh = await load();
      const ref = fresh.candidates.find(
        (item) => item.nodeId === selectedRef.nodeId,
      );
      if (
        !ref ||
        (selectedRef.semanticHash &&
          selectedRef.semanticHash !== ref.semanticHash) ||
        (selectedRef.outputId && selectedRef.outputId !== ref.outputId) ||
        (selectedRef.batchId && selectedRef.batchId !== ref.batchId) ||
        (selectedRef.mediaId && selectedRef.mediaId !== ref.mediaId) ||
        (selectedRef.generationId &&
          selectedRef.generationId !== ref.generationId)
      )
        throw new Error("所选输出已变化，请重新选择具体结果");
      await save({
        expectedRevision: fresh.project.revision,
        artifact: {
          reference: ref,
          status: ref.kind === "prompt" ? "confirmed" : "adopted",
          dependencies: [],
        },
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "确认失败");
    }
  };
  const stage = snapshot
    ? creativeStageLabels[snapshot.progress.stage]
    : "项目约定";
  return (
    <UiProps ids={{"aria-label":["common.m632c7186ff08"]}}><section className={styles.projectState} aria-label="common.m632c7186ff08">
      <button
        type="button"
        className={styles.projectToggle}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <ChevronRight
          size={13}
          style={{ transform: open ? "rotate(90deg)" : undefined }}
        />
        <span>{stage}</span>
        <small>
          {snapshot?.progress.nextAction || <UiText id="common.m274a3a5b8ec0" />}
        </small>
        {!!snapshot?.changes.length && (
          <b>{snapshot.changes.length}<UiText id="common.m64f4a691cf67" /></b>
        )}
      </button>
      {open && (
        <div className={styles.projectBody}>
          <div className={styles.projectActions}>
            <strong><UiText id="common.m5a605d9f1fe4" /></strong>
            <UiProps ids={{"title":["common.m621e17c543bc"]}}><button
              type="button"
              title="common.m621e17c543bc"
              onClick={() =>
                void load().catch((reason) => setError(reason.message))
              }
            >
              <RefreshCw size={13} />
            </button></UiProps>
          </div>
          {!editing ? (
            <>
              <p>
                {snapshot?.project.constraints.join("；") ||
                  <UiText id="common.m120e117f5140" />}
              </p>
              <button
                type="button"
                disabled={busy || hasPending}
                onClick={() => {
                  setConstraints(
                    snapshot?.project.constraints.join("\n") || "",
                  );
                  setConstraintsRevision(snapshot?.project.revision ?? null);
                  setEditing(true);
                }}
              ><UiText id="common.mc51a2c2a6baa" /></button>
            </>
          ) : (
            <>
              <UiProps ids={{"aria-label":["common.m3ba8fe9e4a67"],"placeholder":["common.m2a2da7e7bd22"]}}><textarea
                disabled={busy || hasPending}
                aria-label="common.m3ba8fe9e4a67"
                value={constraints}
                onChange={(event) => setConstraints(event.target.value)}
                placeholder="common.m2a2da7e7bd22"
              /></UiProps>
              <button
                type="button"
                disabled={busy || hasPending || constraintsRevision === null}
                onClick={() =>
                  constraintsRevision !== null &&
                  void save({
                    expectedRevision: constraintsRevision,
                    constraints: constraints
                      .split("\n")
                      .map((line) => line.trim())
                      .filter(Boolean),
                  })
                }
              ><UiText id="common.m4a1edb18155e" /></button>
              <button type="button" onClick={() => setEditing(false)}><UiText id="common.m2cd0f3be8738" /></button>
            </>
          )}
          {!!snapshot?.progress.questions.length && (
            <p><UiText id="common.m34db20180003" />{snapshot.progress.questions.join("；")}</p>
          )}
          {!!selected.length && (
            <div className={styles.projectCandidates}>
              <strong><UiText id="common.mdb92d4303c4e" /></strong>
              {selected
                .filter((ref) =>
                  snapshot?.candidates.some(
                    (item) => item.nodeId === ref.nodeId,
                  ),
                )
                .map((ref) => (
                  <div key={ref.nodeId}>
                    <span>
                      {ref.label}
                      {ref.outputId ? ` · ${ref.outputId.slice(-8)}` : ""}
                    </span>
                    <button
                      type="button"
                      disabled={busy || hasPending}
                      onClick={() => void adopt(ref)}
                    >
                      <Check size={12} />
                      {ref.kind === "prompt" ? <UiText id="common.m35c21059dafa" /> : <UiText id="common.mb3010fe5301f" />}
                    </button>
                  </div>
                ))}
            </div>
          )}
          {snapshot?.project.artifacts
            .filter((item) => item.status !== "revoked")
            .map((item) => (
              <div className={styles.projectArtifact} key={item.id}>
                <span>
                  {item.title} ·{" "}
                  {item.status === "confirmed" ? <UiText id="common.ma9dadb40f6de" /> : <UiText id="common.m5e2cfe70a09c" />}
                </span>
                <UiProps ids={{"title":["common.m2ebb5b95305d"]}}><button
                  type="button"
                  title="common.m2ebb5b95305d"
                  onClick={() => onLocate?.(item.nodeId)}
                >
                  <LocateFixed size={13} />
                </button></UiProps>
                <button
                  type="button"
                  disabled={busy || hasPending}
                  onClick={() =>
                    void save({
                      expectedRevision: snapshot.project.revision,
                      revokeId: item.id,
                      reason: "用户撤销确认；保留原画布成果",
                    })
                  }
                ><UiText id="common.mc72dff41925b" /></button>
              </div>
            ))}
          {snapshot?.changes.map((item) => (
            <p className={styles.projectWarning} key={item.artifactId}>
              {item.title}：{uiLabel(item.reason)}
            </p>
          ))}
          <small><UiText id="common.m781c5220eca3" /></small>
          {hasPending && (
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                pending.current && void save(pending.current.update)
              }
            ><UiText id="common.m0c9ed2b97885" /></button>
          )}
          {error && (
            <p role="alert" className={styles.projectWarning}>
              {uiError(error)}
            </p>
          )}
        </div>
      )}
    </section></UiProps>
  );
}
