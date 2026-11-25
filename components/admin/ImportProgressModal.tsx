"use client";
import { UiText } from "@/i18n/ui";


import * as React from "react";
import { AlertCircle, CheckCircle2, X } from "lucide-react";
import type { ImportAccountOptions, ImportNeedsInput } from "@/lib/admin/user-migration-contracts";

export type ImportStage =
  | "upload" | "parse" | "read" | "check" | "db_user" | "db_gen" | "db_other"
  | "db_agent" | "db_logs" | "seq" | "presets" | "files" | "done" | "error";

export type ImportProgressState = {
  stage: ImportStage;
  message: string;
  progress: number;
  error?: boolean;
  success?: boolean;
  stats?: Record<string, number>;
  conflicts?: string[];
  username?: string;
  jobId?: string;
  needsInput?: ImportNeedsInput;
  warnings?: string[];
};

// 阶段顺序定义（用于步骤指示器）
const STAGE_GROUPS = [
  { label: "上传", stages: ["upload"] },
  { label: "解析", stages: ["parse", "read", "check"] },
  { label: "还原文件", stages: ["presets", "files"] },
  { label: "写入数据库", stages: ["db_user", "db_gen", "db_other", "db_agent", "db_logs", "seq"] },
  { label: "完成", stages: ["done"] },
] as const;

function getGroupIndex(stage: ImportStage): number {
  for (let i = 0; i < STAGE_GROUPS.length; i++) {
    if ((STAGE_GROUPS[i].stages as readonly string[]).includes(stage)) return i;
  }
  return 0;
}

type Props = {
  state: ImportProgressState;
  onClose?: () => void; // 只有 done / error 状态才允许关闭
  onRetry?: (jobId: string, options: ImportAccountOptions) => void;
};

export default function ImportProgressModal({ state, onClose, onRetry }: Props) {
  const [passphrase, setPassphrase] = React.useState("");
  const [newPassword, setNewPassword] = React.useState("");
  const [confirmPassword, setConfirmPassword] = React.useState("");
  const [mergeConfirmed, setMergeConfirmed] = React.useState(false);
  const [inputError, setInputError] = React.useState("");
  const canClose = state.stage === "done" || state.stage === "error";
  const currentGroup = getGroupIndex(state.stage);
  const retry = () => {
    if (!state.jobId || !onRetry) return;
    const requirement = state.needsInput;
    const options: ImportAccountOptions = {};
    if (requirement?.kind === "passphrase") {
      if (passphrase.length < 12 || passphrase.length > 256) {
        setInputError("迁移口令长度必须为 12–256 个字符");
        return;
      }
      options.migrationPassphrase = passphrase;
    } else if (requirement?.kind === "new_password") {
      if (newPassword.length < 4 || newPassword.length > 256) {
        setInputError("新密码长度必须为 4–256 个字符");
        return;
      }
      if (newPassword !== confirmPassword) {
        setInputError("两次输入的新密码不一致");
        return;
      }
      options.newPassword = newPassword;
    } else if (requirement?.kind === "merge") {
      if (!mergeConfirmed || !requirement.username || !Number.isSafeInteger(requirement.targetUserId) || (requirement.targetUserId ?? 0) <= 0) {
        setInputError("请确认合并目标账号");
        return;
      }
      options.mergeTargetUserId = requirement.targetUserId;
    }
    setInputError("");
    setPassphrase("");
    setNewPassword("");
    setConfirmPassword("");
    setMergeConfirmed(false);
    onRetry(state.jobId, options);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={canClose ? onClose : undefined}
      />

      <div className="relative z-10 w-full max-w-sm max-h-[90vh] overflow-y-auto rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] shadow-2xl">
        {/* 标题栏 */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
          <div className="text-[14px] font-semibold text-[var(--app-fg)]">
            {state.stage === "error" ? (state.needsInput ? <UiText id="admin.me292c6bbf148" /> : <UiText id="admin.m01aaebc96af1" />) : state.stage === "done" ? <UiText id="admin.md613fefae300" /> : <UiText id="admin.md0e2dee348a6" />}
          </div>
          {canClose && onClose && (
            <button
              type="button"
              onClick={onClose}
              className="h-7 w-7 rounded-lg text-[var(--app-muted)] hover:bg-[var(--panel-2)] hover:text-[var(--app-fg)] transition flex items-center justify-center"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className="px-5 py-5 space-y-5">
          {/* 进度条 */}
          {state.stage !== "error" && (
            <div className="space-y-2">
              <div className="flex justify-between text-[12px]">
                <span className="text-[var(--app-fg)] font-medium truncate pr-2">{state.message}</span>
                <span className="text-[var(--app-muted)] flex-shrink-0">{state.progress}%</span>
              </div>
              <div className="h-2 w-full rounded-full bg-[var(--panel-2)] overflow-hidden">
                <div
                  className={[
                    "h-full rounded-full transition-all duration-300 ease-out",
                    state.stage === "done" ? "bg-emerald-500" : "bg-blue-500",
                  ].join(" ")}
                  style={{ width: `${state.progress}%` }}
                />
              </div>
            </div>
          )}

          {/* 步骤指示器 */}
          {state.stage !== "error" && (
            <div className="flex items-center gap-0">
              {STAGE_GROUPS.map((group, idx) => {
                const done = idx < currentGroup || state.stage === "done";
                const active = idx === currentGroup && state.stage !== "done";
                return (
                  <React.Fragment key={group.label}>
                    <div className="flex flex-col items-center gap-1 flex-1">
                      <div
                        className={[
                          "h-6 w-6 rounded-full flex items-center justify-center text-[10px] font-bold transition-all",
                          done ? "bg-emerald-500 text-white" : active ? "bg-blue-500/15 border-2 border-blue-500 text-blue-500" : "bg-[var(--panel-2)] text-[var(--app-muted)]",
                        ].join(" ")}
                      >
                        {done ? <CheckCircle2 className="h-3.5 w-3.5" /> : idx + 1}
                      </div>
                      <span className={["text-[9px] text-center whitespace-nowrap leading-tight", done || active ? "text-[var(--app-fg)]" : "text-[var(--app-muted)]"].join(" ")}>
                        {group.label}
                      </span>
                    </div>
                    {idx < STAGE_GROUPS.length - 1 && (
                      <div className={["h-0.5 flex-1 mb-4 transition-colors", done ? "bg-emerald-500" : "bg-[var(--panel-2)]"].join(" ")} />
                    )}
                  </React.Fragment>
                );
              })}
            </div>
          )}

          {/* 错误提示 */}
          {state.stage === "error" && (
            <div className="space-y-3">
              <div className="flex items-start gap-3 p-3 rounded-xl bg-rose-500/10 border border-rose-500/20">
                <AlertCircle className="h-4 w-4 text-rose-400 mt-0.5 flex-shrink-0" />
                <p className="max-h-32 overflow-y-auto break-words text-[12px] text-rose-400 leading-relaxed">{state.message}</p>
              </div>
              {!!state.conflicts?.length && (
                <div className="rounded-xl border border-[var(--border)] bg-[var(--panel-2)] p-3">
                  <div className="mb-2 text-[12px] font-semibold text-[var(--app-fg)]"><UiText id="admin.m8a84d1415af2" />{state.conflicts.length}）
                  </div>
                  <div className="max-h-48 space-y-1 overflow-y-auto pr-1">
                    {state.conflicts.map((filePath) => (
                      <div key={filePath} className="break-all text-[11px] leading-relaxed text-[var(--app-muted)]">
                        {filePath}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {state.needsInput?.kind === "passphrase" && (
                <label className="block text-[12px] text-[var(--app-fg)]"><UiText id="admin.m9f8ad9edd1ea" /><input type="password" autoComplete="off" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} className="mt-2 h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-3 text-[var(--app-fg)]" />
                </label>
              )}
              {state.needsInput?.kind === "new_password" && (
                <div className="space-y-2 text-[12px] text-[var(--app-fg)]">
                  <p><UiText id="admin.m167360f8cd22" />{state.needsInput.username || <UiText id="admin.m9c2aa49d9c58" />}<UiText id="admin.m717400807546" /></p>
                  <label className="block"><UiText id="admin.m6421f2d45fdf" /><input type="password" autoComplete="new-password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className="mt-1 h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-3 text-[var(--app-fg)]" /></label>
                  <label className="block"><UiText id="admin.m6fde05a916c6" /><input type="password" autoComplete="new-password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} className="mt-1 h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-3 text-[var(--app-fg)]" /></label>
                </div>
              )}
              {state.needsInput?.kind === "merge" && (
                <label className="flex items-start gap-2 text-[12px] text-[var(--app-fg)]">
                  <input type="checkbox" checked={mergeConfirmed} onChange={(e) => setMergeConfirmed(e.target.checked)} />
                  <span><UiText id="admin.mfc7a6f650e30" />{state.needsInput.username || <UiText id="admin.m40f908f2e9c3" />}（ID: {state.needsInput.targetUserId}<UiText id="admin.m183fc8a54cec" /></span>
                </label>
              )}
              {inputError && <p role="alert" className="text-[11px] text-rose-400">{inputError}</p>}
            </div>
          )}

          {state.stage === "done" && !!state.warnings?.length && (
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-3">
              <div className="mb-2 text-[12px] font-semibold text-[var(--app-fg)]"><UiText id="admin.mf647a01f2d9b" /></div>
              <div className="max-h-36 space-y-1 overflow-y-auto pr-1">
                {state.warnings.map((warning, index) => <p key={index} className="break-words text-[11px] text-[var(--app-muted)]">{warning}</p>)}
              </div>
            </div>
          )}

          {/* 完成统计 */}
          {state.stage === "done" && state.stats && (
            <div className="grid grid-cols-2 gap-2 pt-1">
              {[
                { label: "资产记录", value: state.stats.generation ?? 0, unit: "条" },
                { label: "物理文件", value: state.stats.files ?? 0, unit: "个" },
                { label: "预设文件", value: state.stats.presetFiles ?? 0, unit: "个" },
                { label: "Agent 对话", value: state.stats.agentConversation ?? 0, unit: "条" },
                { label: "私人素材库", value: state.stats.mediaLibraryItem ?? 0, unit: "条" },
                { label: "挑选记录", value: state.stats.materialAssetSelectionEvent ?? 0, unit: "条" },
                { label: "问题反馈", value: state.stats.feedback ?? 0, unit: "条" },
              ].map(({ label, value, unit }) => (
                <div key={label} className="flex flex-col items-center p-2.5 rounded-xl bg-[var(--panel-2)]">
                  <span className="text-[18px] font-bold text-[var(--app-fg)]">{value}</span>
                  <span className="text-[10px] text-[var(--app-muted)]">{label} ({unit})</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 底部按钮（完成 / 错误时） */}
        {canClose && onClose && (
          <div className="px-5 pb-5 space-y-2">
            {state.stage === "error" && state.jobId && onRetry && (
              <button
                type="button"
                onClick={retry}
                className="h-9 w-full rounded-xl bg-blue-600 text-[13px] font-semibold text-white transition hover:bg-blue-500"
              ><UiText id="admin.m82d31e77ebc8" /></button>
            )}
            <button
              type="button"
              onClick={onClose}
              className={[
                "w-full h-9 rounded-xl text-[13px] font-semibold transition",
                state.stage === "done"
                  ? "bg-emerald-600 text-white hover:bg-emerald-500"
                  : "bg-[var(--panel-2)] text-[var(--app-fg)] hover:bg-[var(--panel-3)]",
              ].join(" ")}
            >
              {state.stage === "done" ? <UiText id="admin.mc0b3fbff51cc" /> : <UiText id="admin.m3fd47edce45b" />}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
