"use client";
import { UiProps, UiText, useUiLocale } from "@/i18n/ui";


import * as React from "react";
import { AlertTriangle, CheckCircle2, Loader2, X } from "lucide-react";

import { FrostedSelect } from "@/components/ui/frosted-select";
import type { ServiceStatus } from "@/lib/monitoring/contracts";
import type { OpsAction } from "@/lib/monitoring/ops-actions";

type OperationState = "queued" | "running" | "succeeded" | "failed";

type OperationPayload = {
  id: string;
  action: OpsAction;
  state: OperationState;
  message?: string | null;
};

const ACTIONS_BY_TARGET: Partial<Record<ServiceStatus["id"], OpsAction[]>> = {
  web: ["web.start", "web.stop", "web.restart"],
  "generation-worker": [
    "canvas-generation.start",
    "canvas-generation.stop",
    "canvas-generation.restart",
  ],
  "media-worker": [
    "canvas-media.start",
    "canvas-media.stop",
    "canvas-media.restart",
  ],
  "live-video-prompt-worker": [
    "live-video-prompt.start",
    "live-video-prompt.stop",
    "live-video-prompt.restart",
  ],
  "live-video-video-worker": [
    "live-video-video.start",
    "live-video-video.stop",
    "live-video-video.restart",
  ],
  prometheus: ["prometheus.start", "prometheus.stop", "prometheus.restart"],
  loki: ["loki.start", "loki.stop", "loki.restart"],
  alloy: ["alloy.start", "alloy.stop", "alloy.restart"],
  nginx: ["nginx.check", "nginx.reload"],
};

const ACTION_LABELS: Record<OpsAction, string> = {
  "web.start": "启动 Web",
  "web.stop": "停止 Web",
  "web.restart": "重启 Web",
  "canvas-generation.start": "启动 Generation Worker",
  "canvas-generation.stop": "停止 Generation Worker",
  "canvas-generation.restart": "重启 Generation Worker",
  "canvas-media.start": "启动 Media Worker",
  "canvas-media.stop": "停止 Media Worker",
  "canvas-media.restart": "重启 Media Worker",
  "live-video-prompt.start": "启动 Live 视频提示词 Worker",
  "live-video-prompt.stop": "停止 Live 视频提示词 Worker",
  "live-video-prompt.restart": "重启 Live 视频提示词 Worker",
  "live-video-video.start": "启动 Live 视频生成 Worker",
  "live-video-video.stop": "停止 Live 视频生成 Worker",
  "live-video-video.restart": "重启 Live 视频生成 Worker",
  "prometheus.start": "启动 Prometheus",
  "prometheus.stop": "停止 Prometheus",
  "prometheus.restart": "重启 Prometheus",
  "loki.start": "启动 Loki",
  "loki.stop": "停止 Loki",
  "loki.restart": "重启 Loki",
  "alloy.start": "启动采集器",
  "alloy.stop": "停止采集器",
  "alloy.restart": "重启采集器",
  "nginx.check": "检查 Nginx 配置",
  "nginx.reload": "安全重载 Nginx",
  "logs.rotate": "立即轮转日志",
};

const TERMINAL_STATES = new Set<OperationState>(["succeeded", "failed"]);

function wait(milliseconds: number) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function isOperationPayload(value: unknown): value is OperationPayload {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<OperationPayload>;
  return typeof candidate.id === "string"
    && typeof candidate.action === "string"
    && typeof candidate.state === "string"
    && ["queued", "running", "succeeded", "failed"].includes(candidate.state);
}

export function operationsForTarget(target: ServiceStatus | null) {
  return target ? ACTIONS_BY_TARGET[target.id] || [] : [];
}

export function MonitoringOperationDialog({
  target,
  onClose,
  onCompleted,
}: {
  target: ServiceStatus | null;
  onClose: () => void;
  onCompleted: () => void;
}) {
  const { label: tLabel } = useUiLocale();
  const { error: uiError } = useUiLocale();
  const actions = operationsForTarget(target);
  const [action, setAction] = React.useState<OpsAction | null>(actions[0] || null);
  const [confirmed, setConfirmed] = React.useState(false);
  const [operation, setOperation] = React.useState<OperationPayload | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const cancelledRef = React.useRef(false);

  React.useEffect(() => {
    cancelledRef.current = false;
    setAction(actions[0] || null);
    setConfirmed(false);
    setOperation(null);
    setError(null);
    setSubmitting(false);
    return () => {
      cancelledRef.current = true;
    };
  }, [target?.id]);

  if (!target || !action) return null;

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/monitoring/v1/actions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, idempotencyKey: crypto.randomUUID() }),
      });
      const initial: unknown = await response.json().catch(() => null);
      if (!response.ok || !isOperationPayload(initial)) {
        const message = initial && typeof initial === "object" && "error" in initial
          ? String((initial as { error?: unknown }).error || "操作提交失败")
          : "操作提交失败";
        throw new Error(message);
      }
      let next: OperationPayload = initial;
      setOperation(next);
      while (!TERMINAL_STATES.has(next.state) && !cancelledRef.current) {
        await wait(2_000);
        const statusResponse: Response = await fetch(
          `/api/admin/monitoring/v1/actions/${encodeURIComponent(next.id)}`,
          { cache: "no-store" },
        );
        const status: unknown = await statusResponse.json().catch(() => null);
        if (!statusResponse.ok || !isOperationPayload(status)) {
          const message = status && typeof status === "object" && "error" in status
            ? String((status as { error?: unknown }).error || "读取操作状态失败")
            : "读取操作状态失败";
          throw new Error(message);
        }
        next = status;
        setOperation(next);
      }
      if (next.state === "succeeded") onCompleted();
    } catch (reason) {
      if (!cancelledRef.current) {
        setError(reason instanceof Error ? reason.message : "操作执行失败");
      }
    } finally {
      if (!cancelledRef.current) setSubmitting(false);
    }
  };

  const destructive = action.endsWith(".stop");
  return (
    <UiProps ids={{"aria-label":["admin.m7294781918d7"]}}><div className="fixed inset-0 !mt-0 z-[190] flex items-center justify-center bg-black/45 p-4" role="dialog" aria-modal="true" aria-label="admin.m7294781918d7">
      <div className="w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] shadow-[var(--shadow)]">
        <div className="flex items-start justify-between border-b border-[var(--border)] p-4">
          <div>
            <h2 className="text-[14px] font-semibold text-[var(--app-fg)]"><UiText id="admin.m7294781918d7" /></h2>
            <p className="mt-1 text-[11px] text-[var(--app-muted)]">{target.name}</p>
          </div>
          <UiProps ids={{"aria-label":["admin.md45f7cc67de9"]}}><button type="button" onClick={onClose} aria-label="admin.md45f7cc67de9" className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--border)] text-[var(--app-muted)] hover:bg-[var(--panel-2)]">
            <X className="h-4 w-4" />
          </button></UiProps>
        </div>
        <div className="space-y-4 p-4">
          <FrostedSelect
            value={action}
            onChange={(value) => {
              setAction(value as OpsAction);
              setConfirmed(false);
            }}
            ariaLabel={tLabel("选择受控运维动作")}
            options={actions.map((value) => ({ value, label: ACTION_LABELS[value] }))}
          />
          <div className={`flex gap-2 rounded-xl border p-3 text-[11px] leading-5 ${destructive ? "border-rose-500/25 bg-rose-500/10 text-rose-700" : "border-amber-500/25 bg-amber-500/10 text-amber-700"}`}>
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              {destructive
                ? <UiText id="admin.m3c89455ce35f" />
                : <UiText id="admin.mfa481db200f8" />}
            </span>
          </div>
          <label className="flex cursor-pointer items-start gap-2 text-[11px] text-[var(--app-fg)]">
            <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} className="mt-0.5 h-4 w-4 accent-[var(--primary-bg)]" />
            <span><UiText id="admin.m4772361e7a1c" /></span>
          </label>
          {operation ? (
            <div className="rounded-xl border border-[var(--border)] bg-[var(--panel-bg)] p-3 text-[11px]">
              <div className="flex items-center gap-2 font-semibold text-[var(--app-fg)]">
                {operation.state === "succeeded"
                  ? <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  : <Loader2 className={`h-4 w-4 ${TERMINAL_STATES.has(operation.state) ? "text-rose-600" : "animate-spin text-[var(--primary-bg)]"}`} />}
                {operation.state === "queued" ? <UiText id="admin.m3cc8745436a7" /> : operation.state === "running" ? <UiText id="admin.m5026a63b58cd" /> : operation.state === "succeeded" ? <UiText id="admin.mf28461bb49c8" /> : <UiText id="admin.m9344597efd49" />}
              </div>
              <p className="mt-1 text-[var(--app-muted)]">{operation.message || <UiText id="admin.m51a8e0e75975" />}</p>
            </div>
          ) : null}
          {error ? <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-3 text-[11px] text-rose-600">{uiError(error)}</div> : null}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="h-9 rounded-lg border border-[var(--border)] px-4 text-[11px] text-[var(--app-muted)] hover:bg-[var(--panel-2)]"><UiText id="admin.m3fd47edce45b" /></button>
            <button type="button" onClick={() => void submit()} disabled={!confirmed || submitting || Boolean(operation && !TERMINAL_STATES.has(operation.state))} className="flex h-9 items-center gap-2 rounded-lg bg-[var(--primary-bg)] px-4 text-[11px] font-semibold text-[var(--primary-fg)] disabled:cursor-not-allowed disabled:opacity-45">
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}<UiText id="admin.m68a35e224268" /></button>
          </div>
        </div>
      </div>
    </div></UiProps>
  );
}
