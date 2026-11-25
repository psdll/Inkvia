"use client";

import { UiText, UiProps, useUiLocale } from "@/i18n/ui";


import * as React from "react";
import { RefreshCw, X } from "lucide-react";
import { adminDisplayName } from "@/lib/admin-utils";
import { clearAuthUsersCache } from "@/lib/admin/auth-users-cache";

type ActiveUserLite = {
  userId: string;
  authUserId?: number | null;
  username?: string | null;
};

type PurgeResult = { ok: boolean; result: Record<string, number> };

type UserPurgeModalProps = {
  open: boolean;
  user: ActiveUserLite | null;
  onClose: () => void;
};

export default function UserPurgeModal({ open, user, onClose }: UserPurgeModalProps) {
  const { error: uiError } = useUiLocale();
  const [genAll, setGenAll] = React.useState(false);
  const [genTypes, setGenTypes] = React.useState<Set<string>>(new Set());
  const [logsData, setLogsData] = React.useState(false);
  const [purgeAgentConversations, setPurgeAgentConversations] = React.useState(false);
  const [purgeAgentMemory, setPurgeAgentMemory] = React.useState(false);
  const [adminPassword, setAdminPassword] = React.useState("");
  const [purging, setPurging] = React.useState(false);
  const [result, setResult] = React.useState<PurgeResult | null>(null);
  const [error, setError] = React.useState("");
  const [finalConfirmArmed, setFinalConfirmArmed] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setGenAll(false);
      setGenTypes(new Set());
      setLogsData(false);
      setPurgeAgentConversations(false);
      setPurgeAgentMemory(false);
      setAdminPassword("");
      setResult(null);
      setError("");
      setFinalConfirmArmed(false);
    }
  }, [open]);

  const handleClose = React.useCallback(() => {
    if (purging) return;
    onClose();
  }, [purging, onClose]);

  const handlePurge = React.useCallback(async () => {
    if (!user) return;
    if (!adminPassword.trim()) {
      setError("请输入管理员密码");
      return;
    }
    if (!finalConfirmArmed) {
      setError("");
      setFinalConfirmArmed(true);
      return;
    }
    setError("");
    setPurging(true);
    try {
      const res = await fetch("/api/admin/user/purge-data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: user.userId,
          authUserId: user.authUserId ?? null,
          purgeGenerations: genAll,
          generationTypes: genTypes.size > 0 ? Array.from(genTypes) : [],
          purgeLogs: logsData,
          purgeAgentConversations,
          purgeAgentMemory,
          adminPassword: adminPassword.trim(),
        }),
      });
      const data = (await res.json()) as PurgeResult & { error?: string };
      if (data.ok) {
        clearAuthUsersCache(); // 清理用户数据后，让系统设置用户面板下次进入拉取最新统计
        setResult(data);
        setAdminPassword("");
        setFinalConfirmArmed(false);
      } else {
        setError(data.error || "清理失败");
        setFinalConfirmArmed(false);
      }
    } catch {
      setError("请求失败，请重试");
      setFinalConfirmArmed(false);
    } finally {
      setPurging(false);
    }
  }, [user, genAll, genTypes, logsData, purgeAgentConversations, purgeAgentMemory, adminPassword, finalConfirmArmed]);

  if (!open || !user) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={handleClose} />
      <div className="relative w-full max-w-md rounded-2xl border border-white/15 bg-[var(--panel-bg)] shadow-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between">
          <div>
            <h2 className="text-[15px] font-semibold text-[var(--app-fg)]"><UiText id="admin.m7af52659812f" /></h2>
            <p className="text-[11px] text-[var(--app-muted)] mt-0.5"><UiText id="admin.m1a78d1d50196" />{adminDisplayName(user)}</p>
          </div>
          <button
            onClick={handleClose}
            className="h-8 w-8 rounded-lg hover:bg-white/10 transition flex items-center justify-center text-[var(--app-muted)]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-6 py-4 space-y-4">
          {result ? (
            <div className="space-y-3">
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 dark:border-emerald-500/20 dark:bg-emerald-500/10">
                <p className="text-[13px] font-medium text-emerald-700 dark:text-emerald-400 mb-2"><UiText id="admin.m6d256e25a3a0" /></p>
                <div className="space-y-1 text-[12px] text-[var(--app-muted)]">
                  {result.result.generations !== undefined && (
                    <p><UiText id="admin.m0e3747da55f1" />{result.result.generations}<UiText id="admin.m7cd3dddec3b5" />{result.result.files ?? 0}<UiText id="admin.m7aaf96ad52e0" /></p>
                  )}
                  {result.result.logs !== undefined && (
                    <p><UiText id="admin.m18dc623ddc40" />{result.result.logs}<UiText id="admin.m6fb2840d568a" /></p>
                  )}
                  {result.result.agentConversations !== undefined && (
                    <p><UiText id="admin.m1d9e10de0847" />{result.result.agentConversations}<UiText id="admin.m95dec01f3a1a" /></p>
                  )}
                  {result.result.agentMemories !== undefined && (
                    <p><UiText id="admin.m867d910028df" />{result.result.agentMemories}<UiText id="admin.m6fb2840d568a" /></p>
                  )}
                </div>
              </div>
              <button
                onClick={() => { setResult(null); onClose(); }}
                className="w-full h-9 rounded-xl bg-[var(--panel-2)] border border-white/10 text-[13px] text-[var(--app-fg)] hover:bg-white/10 transition"
              ><UiText id="admin.m3fd47edce45b" /></button>
            </div>
          ) : (
            <>
              <div className="space-y-2">
                <label className="flex items-center gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={genAll}
                    onChange={(e) => {
                      setGenAll(e.target.checked);
                      if (e.target.checked) setGenTypes(new Set());
                    }}
                    className="w-4 h-4 rounded accent-amber-500"
                  />
                  <span className="text-[13px] font-medium text-[var(--app-fg)]"><UiText id="admin.m26d5fc881990" /></span>
                </label>
                {genAll && (
                  <div className="ml-6 space-y-1.5 border-l-2 border-amber-500/30 pl-3">
                    {[
                      { key: "face_swap", label: "人脸替换" },
                      { key: "image_edit", label: "图片编辑" },
                      { key: "video", label: "视频生成" },
                      { key: "import", label: "导入未引用的素材" },
                    ].map(({ key, label }) => (
                      <label key={key} className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={genTypes.has(key)}
                          onChange={(e) => {
                            const next = new Set(genTypes);
                            if (e.target.checked) next.add(key); else next.delete(key);
                            setGenTypes(next);
                          }}
                          className="w-3.5 h-3.5 rounded accent-amber-500"
                        />
                        <span className="text-[12px] text-[var(--app-muted)]">
                          {label}{genTypes.size === 0 && genAll ? <UiText id="admin.m1595bc4919ee" /> : ""}
                        </span>
                      </label>
                    ))}
                    <p className="text-[11px] text-[var(--app-muted)] italic">
                      {genTypes.size === 0 ? <UiText id="admin.m445e91f7a0ec" /> : <UiText id="admin.m3eda34d438ce" values={{v0: String(Array.from(genTypes).join("、"))}} />}
                    </p>
                  </div>
                )}
              </div>

              <label className="flex items-center gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={logsData}
                  onChange={(e) => setLogsData(e.target.checked)}
                  className="w-4 h-4 rounded accent-amber-500"
                />
                <span className="text-[13px] font-medium text-[var(--app-fg)]"><UiText id="admin.m263155a74dad" /></span>
              </label>

              <label className="flex items-center gap-2.5 cursor-pointer">
                <input type="checkbox" checked={purgeAgentConversations} onChange={(e) => setPurgeAgentConversations(e.target.checked)} className="w-4 h-4 rounded accent-amber-500" />
                <span><span className="block text-[13px] font-medium text-[var(--app-fg)]"><UiText id="admin.m84de0584d385" /></span><span className="block text-[11px] text-[var(--app-muted)]"><UiText id="admin.m604ae3e6e128" /></span></span>
              </label>

              <label className="flex items-center gap-2.5 cursor-pointer">
                <input type="checkbox" checked={purgeAgentMemory} onChange={(e) => setPurgeAgentMemory(e.target.checked)} className="w-4 h-4 rounded accent-amber-500" />
                <span><span className="block text-[13px] font-medium text-[var(--app-fg)]"><UiText id="admin.m1abafae300b4" /></span><span className="block text-[11px] text-[var(--app-muted)]"><UiText id="admin.ma461a7ae198f" /></span></span>
              </label>

              {!genAll && !logsData && !purgeAgentConversations && !purgeAgentMemory && (
                <p className="text-[11px] text-amber-700 dark:text-amber-400"><UiText id="admin.m164be3e7e3b5" /></p>
              )}

              <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 dark:border-amber-500/20 dark:bg-amber-500/8">
                <p className="text-[11px] text-amber-700 dark:text-amber-400"><UiText id="admin.m6b68df3c138b" /></p>
              </div>

              <div className="space-y-2">
                <label className="block text-xs font-medium text-[var(--app-fg)]"><UiText id="admin.mc19091521d71" /></label>
                <UiProps ids={{"placeholder":["admin.m1a4e08f372ef"]}}><input
                  type="password"
                  value={adminPassword}
                  onChange={(e) => {
                    setAdminPassword(e.target.value);
                    setError("");
                    setFinalConfirmArmed(false);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void handlePurge();
                    }
                  }}
                  placeholder="admin.m1a4e08f372ef"
                  className="w-full rounded-xl border border-[var(--border)] bg-[var(--input-bg)] px-3 py-2.5 text-sm text-[var(--app-fg)] outline-none focus:ring-2 focus:ring-blue-500/20"
                /></UiProps>
                {error ? (
                  <p className="text-[11px] text-rose-500">{uiError(error)}</p>
                ) : finalConfirmArmed ? (
                  <p className="rounded-lg border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-[11px] font-medium text-rose-600"><UiText id="admin.m2a187ef7223f" /></p>
                ) : (
                  <p className="text-[11px] text-[var(--app-muted)]"><UiText id="admin.m3a17794f8707" /></p>
                )}
              </div>

              <div className="flex gap-2 pt-1">
                <button
                  onClick={onClose}
                  disabled={purging}
                  className="flex-1 h-9 rounded-xl bg-[var(--panel-2)] border border-white/10 text-[13px] text-[var(--app-fg)] hover:bg-white/10 transition disabled:opacity-50"
                ><UiText id="admin.m2cd0f3be8738" /></button>
                <button
                  disabled={purging || (!genAll && !logsData && !purgeAgentConversations && !purgeAgentMemory) || !adminPassword.trim()}
                  onClick={() => void handlePurge()}
                  className="flex-1 h-9 rounded-xl bg-amber-500 text-white text-[13px] font-semibold hover:bg-amber-400 transition disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {purging ? <><RefreshCw className="w-4 h-4 animate-spin" /><UiText id="admin.m248e8cfc2116" /></> : finalConfirmArmed ? <UiText id="admin.m46da7dc7872d" /> : <UiText id="admin.m7ba2d6728fe2" />}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
