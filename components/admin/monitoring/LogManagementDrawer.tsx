"use client";
import { UiProps, UiText, useUiLocale } from "@/i18n/ui";


import * as React from "react";
import { ArchiveX, CheckCircle2, Loader2, RefreshCw, RotateCw, ShieldAlert, X } from "lucide-react";

import type { MonitoringCapabilities } from "@/lib/monitoring/contracts";

type DeletePlan = {
  planId: string;
  expiresAt: string;
  files: Array<{ name: string; sizeBytes: number; modifiedAt: string }>;
  totalBytes: number;
};

type Operation = {
  id: string;
  state: "queued" | "running" | "succeeded" | "failed";
  message?: string | null;
};

const TERMINAL = new Set(["succeeded", "failed"]);

function wait(milliseconds: number) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 ** 2).toFixed(1)} MB`;
}

async function pollOperation(operation: Operation, cancelled: () => boolean) {
  let current = operation;
  while (!TERMINAL.has(current.state) && !cancelled()) {
    await wait(2_000);
    const response = await fetch(
      `/api/admin/monitoring/v1/actions/${encodeURIComponent(current.id)}`,
      { cache: "no-store" },
    );
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(payload?.error || "读取操作状态失败");
    current = payload;
  }
  return current;
}

export function LogManagementDrawer({
  open,
  capabilities,
  onClose,
}: {
  open: boolean;
  capabilities: MonitoringCapabilities | null;
  onClose: () => void;
}) {
  const { error: uiError } = useUiLocale();
  const [plan, setPlan] = React.useState<DeletePlan | null>(null);
  const [operation, setOperation] = React.useState<Operation | null>(null);
  const [confirmed, setConfirmed] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const cancelledRef = React.useRef(false);

  React.useEffect(() => {
    cancelledRef.current = false;
    if (!open) {
      setPlan(null);
      setOperation(null);
      setConfirmed(false);
      setError(null);
      setBusy(false);
    }
    return () => {
      cancelledRef.current = true;
    };
  }, [open]);

  if (!open) return null;

  const runOperation = async (endpoint: string, body: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || "提交操作失败");
      setOperation(payload);
      const finished = await pollOperation(payload, () => cancelledRef.current);
      if (!cancelledRef.current) {
        setOperation(finished);
        if (finished.state !== "succeeded") {
          throw new Error(finished.message || "操作未通过执行后检查");
        }
      }
      return finished;
    } catch (reason) {
      if (!cancelledRef.current) {
        setError(reason instanceof Error ? reason.message : "操作执行失败");
      }
      return null;
    } finally {
      if (!cancelledRef.current) setBusy(false);
    }
  };

  const rotate = () => runOperation(
    "/api/admin/monitoring/v1/logs/rotate",
    { idempotencyKey: crypto.randomUUID() },
  );

  const createPlan = async () => {
    setBusy(true);
    setError(null);
    setOperation(null);
    try {
      const response = await fetch("/api/admin/monitoring/v1/logs/delete-plan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || "生成删除清单失败");
      setPlan(payload);
      setConfirmed(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "生成删除清单失败");
    } finally {
      setBusy(false);
    }
  };

  const applyPlan = async () => {
    if (!plan) return;
    const finished = await runOperation(
      "/api/admin/monitoring/v1/logs/delete-apply",
      { planId: plan.planId, idempotencyKey: crypto.randomUUID() },
    );
    if (finished?.state === "succeeded") {
      setPlan(null);
      setConfirmed(false);
    }
  };

  return (
    <UiProps ids={{"aria-label":["admin.mae8b48aea694"]}}><div className="fixed inset-0 !mt-0 z-[170] flex justify-end bg-black/35" role="dialog" aria-modal="true" aria-label="admin.mae8b48aea694">
      <div className="h-full w-full max-w-lg overflow-y-auto border-l border-[var(--border)] bg-[var(--panel-bg)] shadow-[var(--shadow)]">
        <div className="flex items-start justify-between border-b border-[var(--border)] p-4">
          <div>
            <h2 className="text-[14px] font-semibold text-[var(--app-fg)]"><UiText id="admin.mae8b48aea694" /></h2>
            <p className="mt-1 text-[11px] text-[var(--app-muted)]"><UiText id="admin.m7cfcd48ae4f9" /></p>
          </div>
          <UiProps ids={{"aria-label":["admin.m4d0340c37261"]}}><button type="button" onClick={onClose} aria-label="admin.m4d0340c37261" className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--border)] text-[var(--app-muted)] hover:bg-[var(--panel-2)]">
            <X className="h-4 w-4" />
          </button></UiProps>
        </div>
        <div className="space-y-3 p-4">
          <section className="rounded-xl border border-[var(--border)] bg-[var(--panel-bg)] p-4">
            <div className="flex items-start gap-3">
              <ShieldAlert className="mt-0.5 h-4 w-4 text-emerald-600" />
              <div className="min-w-0 flex-1">
                <h3 className="text-[12px] font-semibold text-[var(--app-fg)]"><UiText id="admin.m3ade36a87a11" /></h3>
                <p className="mt-1 text-[11px] leading-5 text-[var(--app-muted)]"><UiText id="admin.m1d65f905f343" /></p>
                <p className="mt-2 text-[10px] leading-4 text-[var(--app-muted)]"><UiText id="admin.m17c25c12fdc2" /></p>
              </div>
            </div>
          </section>

          <section className="rounded-xl border border-[var(--border)] bg-[var(--panel-bg)] p-4">
            <div className="flex items-start gap-3">
              <RotateCw className="mt-0.5 h-4 w-4 text-[var(--primary-bg)]" />
              <div className="min-w-0 flex-1">
                <h3 className="text-[12px] font-semibold text-[var(--app-fg)]"><UiText id="admin.m2c99f103ed82" /></h3>
                <p className="mt-1 text-[11px] leading-5 text-[var(--app-muted)]"><UiText id="admin.mc951b829f5b0" /></p>
                <button type="button" onClick={() => void rotate()} disabled={busy || !capabilities?.logRotation} className="mt-3 flex h-8 items-center gap-1.5 rounded-lg bg-[var(--primary-bg)] px-3 text-[11px] font-semibold text-[var(--primary-fg)] disabled:cursor-not-allowed disabled:opacity-45">
                  {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}<UiText id="admin.m2c99f103ed82" /></button>
              </div>
            </div>
          </section>

          <section className="rounded-xl border border-[var(--border)] bg-[var(--panel-bg)] p-4">
            <div className="flex items-start gap-3">
              <ArchiveX className="mt-0.5 h-4 w-4 text-amber-600" />
              <div className="min-w-0 flex-1">
                <h3 className="text-[12px] font-semibold text-[var(--app-fg)]"><UiText id="admin.m4acb955e5a88" /></h3>
                <p className="mt-1 text-[11px] leading-5 text-[var(--app-muted)]"><UiText id="admin.m646f4f7c7062" /></p>
                <button type="button" onClick={() => void createPlan()} disabled={busy || !capabilities?.logDeletion} className="mt-3 h-8 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 text-[11px] font-semibold text-amber-700 disabled:cursor-not-allowed disabled:opacity-45"><UiText id="admin.m5f07ab24d8a3" /></button>
                {plan ? (
                  <div className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--panel-2)] p-3">
                    <div className="flex items-center justify-between text-[11px] font-semibold text-[var(--app-fg)]">
                      <span>{plan.files.length}<UiText id="admin.mff7a7e19a5bf" /></span>
                      <span>{formatBytes(plan.totalBytes)}</span>
                    </div>
                    <div className="mt-2 max-h-36 space-y-1 overflow-y-auto font-mono text-[10px] text-[var(--app-muted)]">
                      {plan.files.length
                        ? plan.files.map((file) => <div key={file.name} className="flex justify-between gap-3"><span className="truncate">{file.name}</span><span className="shrink-0">{formatBytes(file.sizeBytes)}</span></div>)
                        : <div><UiText id="admin.m088cce6712f0" /></div>}
                    </div>
                    <label className="mt-3 flex cursor-pointer items-start gap-2 text-[10px] text-[var(--app-fg)]">
                      <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} className="mt-0.5 h-4 w-4 accent-amber-600" />
                      <span><UiText id="admin.m4c7a3e9d1b06" /></span>
                    </label>
                    <button type="button" onClick={() => void applyPlan()} disabled={busy || !confirmed || plan.files.length === 0} className="mt-3 h-8 rounded-lg bg-amber-600 px-3 text-[11px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-45"><UiText id="admin.mfa9a2e8e91af" /></button>
                  </div>
                ) : null}
              </div>
            </div>
          </section>

          {operation ? (
            <div className="flex items-start gap-2 rounded-xl border border-[var(--border)] bg-[var(--panel-bg)] p-3 text-[11px]">
              {operation.state === "succeeded" ? <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-600" /> : <Loader2 className={`mt-0.5 h-4 w-4 ${TERMINAL.has(operation.state) ? "text-rose-600" : "animate-spin text-[var(--primary-bg)]"}`} />}
              <span className="text-[var(--app-muted)]">{operation.message || operation.state}</span>
            </div>
          ) : null}
          {error ? <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-3 text-[11px] text-rose-600">{uiError(error)}</div> : null}
          <div className="flex gap-2 rounded-xl border border-rose-500/20 bg-rose-500/10 p-3 text-[11px] leading-5 text-rose-700">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <span><UiText id="admin.m48fc5ec082ce" /></span>
          </div>
          {!capabilities?.logDeletion ? (
            <p className="text-[10px] text-[var(--app-muted)]"><UiText id="admin.m0e09c1276b9e" /></p>
          ) : null}
        </div>
      </div>
    </div></UiProps>
  );
}
